import type { Prisma } from "@/src/generated/prisma";
import { loadApprovedSections } from "@/src/pipeline/draft/approved-stories";
import { articleReadLogData, describeArticleRead, summarizeArticleReads, type ArticleReadReport } from "@/src/pipeline/draft/articles";
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
  untilAborted,
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

/**
 * Netlify stops a background function at 15 minutes, without warning. The job gives up at 13, so it still has
 * time to mark the draft failed and raise the incident.
 */
export const DRAFT_DEADLINE_MS = 13 * 60_000;

export type RunDraftJobResult =
  | { status: "ready"; draftId: number; runId: string; issue: IssueUpdate }
  /** `runId` is null when the run log itself could not be started. */
  | { status: "failed"; draftId: number; runId: string | null; step: DraftJobStep; error: string }
  | { status: "skipped"; draftId: number; reason: string };

export interface RunDraftJobOptions {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Defaults to `event`: a commit or a retry started it. */
  trigger?: RunTrigger;
  /** Replaces the real services (tests). */
  deps?: Partial<Omit<ProduceDraftDeps, "onStep" | "onRewrite" | "signal">>;
  /** Defaults to `DRAFT_DEADLINE_MS`. */
  deadlineMs?: number;
}

/** This deploy's site: Netlify's `URL` in production, the deploy's own address on previews, else production. */
export function siteUrl(env: Record<string, string | undefined>): string {
  const candidates = env.APP_ENV === "production" ? [env.URL] : [env.DEPLOY_PRIME_URL, env.URL];
  const url = candidates.map((value) => value?.trim()).find(Boolean);
  return (url ?? SITE_URL).replace(/\/+$/, "");
}

/** The drafts page for a date (#79), where the owner sees the failed step and can retry. */
export function draftsLink(date: string, env: Record<string, string | undefined> = {}): string {
  return `${siteUrl(env)}/approval/drafts?date=${encodeURIComponent(date)}`;
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

function minutes(ms: number): string {
  return String(Math.round(ms / 6_000) / 10);
}

export async function runDraftJob(draftId: bigint | number | string, options: RunDraftJobOptions = {}): Promise<RunDraftJobResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? DRAFT_DEADLINE_MS;
  const id = Number(draftId);

  const draft = await findDraftToRun(draftId);
  if (!draft) return { status: "skipped", draftId: id, reason: `Draft ${draftId} does not exist.` };
  if (draft.status !== "running") return { status: "skipped", draftId: id, reason: `Draft ${draftId} is ${draft.status}, not waiting to run.` };
  if (!(await claimDraft(draft.id, now()))) return { status: "skipped", draftId: id, reason: `Draft ${draftId} is running already.` };

  const date = draft.issueDate ?? `issue-${draft.issueId}`;
  const incidentKey = draftIncidentKey(date);
  const stepMs: Partial<Record<DraftJobStep, number>> = {};
  let runId: bigint | null = null;
  let step: DraftJobStep = "load";
  let produced: ProducedDraft | null = null;

  const log = async (event: Parameters<typeof logEvent>[1]) => {
    if (runId !== null) await logEvent(runId, event);
  };
  const enter = async (next: DraftJobStep) => {
    step = next;
    if (next !== "load") await setDraftStep(draft.id, next);
    await log({ level: "info", step: next, message: `Started ${DRAFT_STEP_LABELS[next]}.` });
  };
  // The count only: the problems quote the written text.
  const onRewrite = async (problemCount: number) => {
    await log({
      level: "warn",
      step: "write",
      message: `The written issue failed ${problemCount} ${problemCount === 1 ? "check" : "checks"}. Writing it once more with the problems listed.`,
      data: { problems: problemCount },
    });
  };
  const record = async (entry: SideEffectRecord) => {
    await log({
      level: "info",
      step: "ghl",
      message: "Not sent outside production. Recorded the call.",
      data: { target: entry.target, action: entry.action, payload: withoutHtml(entry.payload) } as Prisma.InputJsonValue,
    });
  };
  // One event per feature story (#120): how its article was read, or why not. The article text stays out.
  const onArticleReads = async (reads: ArticleReadReport[]) => {
    for (const read of reads) {
      await log({
        level: read.status === "read" ? "info" : "warn",
        step: "read_articles",
        message: describeArticleRead(read),
        data: articleReadLogData(read) as unknown as Prisma.InputJsonValue,
      });
    }
    await log({ level: "info", step: "read_articles", message: summarizeArticleReads(reads) });
  };
  const onArticleWarning = async (message: string) => {
    await log({ level: "warn", step: "read_articles", message });
  };
  const onArticleInfo = async (message: string) => {
    await log({ level: "info", step: "read_articles", message });
  };

  /** Runs one bookkeeping write. A failure is logged (if it can be) and returned, and never stops the job. */
  const bestEffort = async (logStep: string, what: string, work: () => Promise<unknown>): Promise<string | null> => {
    try {
      await work();
      return null;
    } catch (error) {
      const problem = `Could not ${what}: ${plainError(error, step, null)}`;
      try {
        await log({ level: "warn", step: logStep, message: problem });
      } catch {
        console.error(`[draft-issue] Draft ${id}: ${problem}`);
      }
      return problem;
    }
  };

  /** Marks the draft failed and raises the incident. Each write is separate, so the incident goes out regardless. */
  const failDraft = async (error: unknown): Promise<RunDraftJobResult> => {
    const failedStep: DraftJobStep = error instanceof DraftStepError ? error.step : step;
    if (error instanceof DraftStepError) Object.assign(stepMs, error.stepMs);
    const message = plainError(error, failedStep, produced);

    const problems = [
      await bestEffort("save", "mark the draft failed", () =>
        saveFailedDraft(draft.id, { step: failedStep, error: message, partial: partialFrom(error, produced) }, now()),
      ),
      await bestEffort("run", "log the failure", () => log({ level: "error", step: failedStep, message })),
      await bestEffort("run", "finish the run", async () => {
        if (runId === null) throw new Error("The run log was never started.");
        await finishRun(runId, { status: "failed", error: message, stats: { draftId: id, version: draft.version, issueDate: date, failedStep, stepMs } }, now());
      }),
    ].filter((problem): problem is string => problem !== null);

    await bestEffort("alert", `raise ${incidentKey}`, () =>
      raiseIncident(
        {
          incidentKey,
          severity: "critical",
          what: `Draft v${draft.version} for ${date} failed at ${DRAFT_STEP_LABELS[failedStep]}.`,
          evidence: message,
          link: draftsLink(date, env),
          details: {
            draftId: id,
            version: draft.version,
            step: failedStep,
            runId: runId?.toString() ?? null,
            ...(problems.length > 0 ? { alsoFailed: problems } : {}),
          },
        },
        { runId: runId ?? undefined, env, now: now() },
      ),
    );
    return { status: "failed", draftId: id, runId: runId?.toString() ?? null, step: failedStep, error: message };
  };

  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error(`The draft timed out after ${minutes(deadlineMs)} min. Netlify stops the job at 15 min.`)),
    deadlineMs,
  );

  let saved: { issue: { id: number; date: string }; issueUpdate: IssueUpdate; produced: ProducedDraft };
  try {
    runId = await startRun({ job: DRAFT_JOB, trigger: options.trigger ?? "event" }, now());
    await enter("load");
    const loadStarted = Date.now();
    const { outline, issue, stories } = await untilAborted(
      (async () => {
        if ((await readDraftOwner()) !== "native") throw new Error("draft.owner is n8n, so native drafting is off.");
        const inputs = await loadDraftInputs(draft);
        return { ...inputs, stories: await loadApprovedSections(inputs.outline) };
      })(),
      deadline.signal,
    );
    stepMs.load = Date.now() - loadStarted;

    produced = await produceDraft(
      { outline, stories, issue, draft: { id, version: draft.version } },
      {
        ...createDraftDeps(env, { record, onArticleReads, onArticleWarning, onArticleInfo }),
        ...options.deps,
        onStep: enter,
        onRewrite,
        signal: deadline.signal,
      },
    );
    Object.assign(stepMs, produced.stepMs);

    // Not cut short by the deadline: a save that commits after the draft was marked failed would contradict it.
    await enter("save");
    saved = { issue, produced, issueUpdate: await saveReadyDraft({ ...draft, issueDate: issue.date }, produced, now()) };
  } catch (error) {
    return failDraft(error);
  } finally {
    clearTimeout(timer);
  }

  // The draft is saved. Problems with the run log or the incident from here on do not undo that.
  const { issue, issueUpdate } = saved;
  const stats = {
    draftId: id,
    issueId: issue.id,
    version: draft.version,
    issueDate: issue.date,
    issue: issueUpdate,
    ghlMode: saved.produced.ghlMode,
    unreadStoryIds: saved.produced.unreadStoryIds,
    stepMs,
  };
  const readyRunId: bigint = runId!;
  await bestEffort("run", "finish the run", () => finishRun(readyRunId, { status: "succeeded", stats }, now()));
  await bestEffort("alert", `resolve ${incidentKey}`, () =>
    resolveIncident(incidentKey, { runId: readyRunId, env, now: now(), link: draftsLink(issue.date, env), note: `Draft v${draft.version} is ready.` }),
  );
  return { status: "ready", draftId: id, runId: readyRunId.toString(), issue: issueUpdate };
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
