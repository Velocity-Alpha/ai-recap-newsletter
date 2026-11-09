import type { Prisma } from "@/src/generated/prisma";
import { loadApprovedSections } from "@/src/pipeline/draft/approved-stories";
import {
  claimDraft,
  findDraftToRun,
  loadDraftInputs,
  saveFailedDraft,
  saveReadyDraft,
  setDraftStep,
  type IssueUpdate,
} from "@/src/pipeline/draft/draft-store";
import { readDraftOwner } from "@/src/pipeline/draft/outline-store";
import {
  createDraftDeps,
  DraftStepError,
  produceDraft,
  type DraftStep,
  type PartialDraft,
  type ProduceDraftDeps,
  type ProducedDraft,
} from "@/src/pipeline/draft/produce-draft";
import { raiseIncident, resolveIncident } from "@/src/pipeline/notify";
import { finishRun, logEvent, startRun, type RunTrigger } from "@/src/pipeline/runs";
import type { SideEffectRecord } from "@/src/pipeline/side-effects";

/**
 * The `draft-issue` job (#76): runs one draft that `createDraft` (or `retryDraft`) left in `running`. It writes
 * each step to the draft row for the board, logs the run to pipeline_runs and pipeline_events, and on success
 * copies the draft to the issue row. A failure marks the draft failed at its step and raises
 * `draft.failed:<date>`; the next ready draft for that date resolves it.
 */

export const DRAFT_JOB = "draft-issue";

/** produceDraft's steps, plus loading the inputs before and saving the result after. */
export type DraftJobStep = "load" | DraftStep | "save";

/** Plain labels for the run log, the incident, and the board. */
export const DRAFT_STEP_LABELS: Record<DraftJobStep, string> = {
  load: "loading the outline",
  read_articles: "reading articles",
  write: "writing",
  validate: "checking the writing",
  image: "making the image",
  html: "building the email",
  ghl: "creating the GHL template",
  save: "saving the draft",
};

const MAX_ERROR_CHARS = 2_000;
const SITE_URL = "https://airecap.news";

export type RunDraftJobResult =
  | { status: "ready"; draftId: number; runId: string; issue: IssueUpdate }
  | { status: "failed"; draftId: number; runId: string; step: DraftJobStep; error: string }
  | { status: "skipped"; draftId: number; reason: string };

export interface RunDraftJobOptions {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Defaults to `event`: a commit or a retry started it. */
  trigger?: RunTrigger;
  /** Replaces the real services (tests). */
  deps?: Partial<Omit<ProduceDraftDeps, "onStep">>;
}

/** The board for a date, where the owner sees the draft and can retry it. */
export function boardLink(date: string): string {
  return `${SITE_URL}/approval?date=${encodeURIComponent(date)}`;
}

export function draftIncidentKey(date: string): string {
  return `draft.failed:${date}`;
}

function plainError(error: unknown, step: DraftJobStep, produced: ProducedDraft | null): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (step === "save" && code === "P2002" && produced) {
    return `Another issue already uses the title "${produced.content.title}", and titles must be unique. Retry to write a new title.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}...` : message;
}

/** GHL calls recorded outside production go into the run log, without the email HTML. */
function withoutHtml(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutHtml);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "html" && typeof item === "string" ? `[${item.length} characters of HTML]` : withoutHtml(item),
      ]),
    );
  }
  return value;
}

function partialFrom(error: unknown, produced: ProducedDraft | null): PartialDraft {
  if (error instanceof DraftStepError) return error.partial;
  if (!produced) return {};
  const { content, html, featuredImageUrl, scenePrompt, unreadStoryIds, ghlTemplateId, ghlPreviewUrl } = produced;
  return { content, html, featuredImageUrl, scenePrompt, unreadStoryIds, ghlTemplateId, ghlPreviewUrl: ghlPreviewUrl ?? undefined };
}

export async function runDraftJob(draftId: bigint | number | string, options: RunDraftJobOptions = {}): Promise<RunDraftJobResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const id = Number(draftId);

  const draft = await findDraftToRun(draftId);
  if (!draft) return { status: "skipped", draftId: id, reason: `Draft ${draftId} does not exist.` };
  if (draft.status !== "running") return { status: "skipped", draftId: id, reason: `Draft ${draftId} is ${draft.status}, not waiting to run.` };
  if (!(await claimDraft(draft.id, now()))) return { status: "skipped", draftId: id, reason: `Draft ${draftId} is running already.` };

  const runId = await startRun({ job: DRAFT_JOB, trigger: options.trigger ?? "event" }, now());
  const date = draft.issueDate ?? `issue-${draft.issueId}`;
  const incidentKey = draftIncidentKey(date);
  const stepMs: Partial<Record<DraftJobStep, number>> = {};
  let step: DraftJobStep = "load";
  let produced: ProducedDraft | null = null;

  const enter = async (next: DraftJobStep) => {
    step = next;
    if (next !== "load") await setDraftStep(draft.id, next);
    await logEvent(runId, { level: "info", step: next, message: `Started ${DRAFT_STEP_LABELS[next]}.` });
  };
  const record = async (entry: SideEffectRecord) => {
    await logEvent(runId, {
      level: "info",
      step: "ghl",
      message: "Not sent outside production. Recorded the call.",
      data: { target: entry.target, action: entry.action, payload: withoutHtml(entry.payload) } as Prisma.InputJsonValue,
    });
  };

  try {
    await enter("load");
    const loadStarted = Date.now();
    if ((await readDraftOwner()) !== "native") throw new Error("draft.owner is n8n, so native drafting is off.");
    const { outline, issue } = await loadDraftInputs(draft);
    const stories = await loadApprovedSections(outline);
    stepMs.load = Date.now() - loadStarted;

    produced = await produceDraft(
      { outline, stories, issue, draft: { id, version: draft.version } },
      { ...createDraftDeps(env, { record }), ...options.deps, onStep: enter },
    );
    Object.assign(stepMs, produced.stepMs);

    await enter("save");
    const issueUpdate = await saveReadyDraft({ ...draft, issueDate: issue.date }, produced, now());

    const stats = { draftId: id, issueId: issue.id, version: draft.version, issueDate: issue.date, issue: issueUpdate, ghlMode: produced.ghlMode, unreadStoryIds: produced.unreadStoryIds, stepMs };
    await finishRun(runId, { status: "succeeded", stats }, now());
    try {
      await resolveIncident(incidentKey, { runId, env, now: now(), link: boardLink(issue.date), note: `Draft v${draft.version} is ready.` });
    } catch (error) {
      await logEvent(runId, { level: "warn", step: "alert", message: `Could not resolve ${incidentKey}: ${plainError(error, "save", null)}` });
    }
    return { status: "ready", draftId: id, runId: runId.toString(), issue: issueUpdate };
  } catch (error) {
    const failedStep: DraftJobStep = error instanceof DraftStepError ? error.step : step;
    if (error instanceof DraftStepError) Object.assign(stepMs, error.stepMs);
    const message = plainError(error, failedStep, produced);

    await saveFailedDraft(draft.id, { step: failedStep, error: message, partial: partialFrom(error, produced) }, now());
    await logEvent(runId, { level: "error", step: failedStep, message });
    await finishRun(runId, { status: "failed", error: message, stats: { draftId: id, version: draft.version, issueDate: date, failedStep, stepMs } }, now());
    try {
      await raiseIncident(
        {
          incidentKey,
          severity: "critical",
          what: `Draft v${draft.version} for ${date} failed at ${DRAFT_STEP_LABELS[failedStep]}.`,
          evidence: message,
          link: boardLink(date),
          details: { draftId: id, version: draft.version, step: failedStep, runId: runId.toString() },
        },
        { runId, env, now: now() },
      );
    } catch (alertError) {
      await logEvent(runId, { level: "warn", step: "alert", message: `Could not raise ${incidentKey}: ${plainError(alertError, failedStep, null)}` });
    }
    return { status: "failed", draftId: id, runId: runId.toString(), step: failedStep, error: message };
  }
}

export function describeDraftRun(result: RunDraftJobResult): string {
  switch (result.status) {
    case "ready":
      return `Run ${result.runId}: draft ${result.draftId} is ready (issue: ${result.issue}).`;
    case "failed":
      return `Run ${result.runId}: draft ${result.draftId} failed at ${result.step}: ${result.error}`;
    case "skipped":
      return `${result.reason} Nothing to do.`;
  }
}
