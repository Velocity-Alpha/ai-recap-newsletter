import type { Prisma } from "@/src/generated/prisma";
import { distributionServiceFromEnv, type DistributionService } from "@/src/pipeline/distribution/service";
import { draftChangedSinceStaged, stagedEmailName, stageIncidentKey } from "@/src/pipeline/distribution/staged-version";
import type { WrittenIssueContent } from "@/src/pipeline/draft/content";
import { dateKey, IssuePublishedError, lockIssueDate, publishedIssueFor } from "@/src/pipeline/draft/draft-store";
import { draftsLink } from "@/src/pipeline/draft/drafts-link";
import { renderIssueEmailHtml } from "@/src/pipeline/draft/email-html";
import { raiseIncident, resolveIncident } from "@/src/pipeline/notify";
import { finishRun, logEvent, startRun } from "@/src/pipeline/runs";
import { withoutHtml, type SideEffectRecord } from "@/src/pipeline/side-effects";
import { prisma } from "@/src/server/prisma";

/**
 * "Stage for sending" (#149, ADR 0004): copies the current draft into the distribution service as the issue's
 * next staged version. It runs inside the request, with no background job. A `staging` row holds the version
 * number while the service call runs, so two clicks make one version. A failed call leaves no row and raises
 * `stage.failed:<date>`; the next staging that works resolves it, and `run-checks` closes it when its day is
 * over. An older staged version is never changed.
 */

export const STAGE_JOB = "stage-draft";

/** A `staging` row older than this is a crashed attempt: the whole call is over well inside one minute. */
export const STAGING_STALE_AFTER_MS = 2 * 60_000;
/** Netlify stops the request at 60 s, so the service call gets half of that. */
export const STAGE_TIMEOUT_MS = 30_000;

const MAX_ERROR_CHARS = 2_000;

export type StageRefusal =
  /** No such draft, or its issue has no date. */
  | "missing"
  /** A newer draft of the issue exists. */
  | "not_current"
  /** The draft is running or failed. */
  | "not_ready"
  /** Another staging of this issue is running now. */
  | "staging_running"
  /** The draft has not changed since the newest staged version, and the owner has not confirmed a repeat. */
  | "already_staged"
  /** The distribution service call failed. Nothing was staged. */
  | "service_failed"
  /** The service made the email, but the staged version could not be saved. The email is in the service. */
  | "not_saved";

export class StageError extends Error {
  constructor(
    message: string,
    readonly code: StageRefusal,
    /** `already_staged` only: the staged version the draft matches. */
    readonly version?: number,
  ) {
    super(message);
    this.name = "StageError";
  }
}

export interface StagedVersionResult {
  /** staged_versions.id: the `data-version-id` in the staged email. */
  id: number;
  version: number;
  /** YYYY-MM-DD */
  issueDate: string;
  title: string;
  /** The distribution service's key and the name the owner sees. */
  service: string;
  serviceName: string;
  serviceRef: string;
  serviceUrl: string | null;
  /** `recorded` outside production: nothing reached the service. */
  mode: "sent" | "recorded";
  stagedAt: Date;
}

export interface StageDraftDeps {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Replaces the service built from env (tests). */
  service?: DistributionService;
  /** Defaults to `STAGE_TIMEOUT_MS`. */
  timeoutMs?: number;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}...` : message;
}

/** The work's result, or a plain timeout error. The service call itself is not cancelled. */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s.`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

interface Reservation {
  id: bigint;
  issueId: bigint;
  version: number;
  title: string;
  content: WrittenIssueContent;
  featuredImageUrl: string | null;
}

/**
 * Checks the draft and inserts the `staging` row, all under the issue-date lock, so a commit, an edit, or a
 * second click cannot slip in between the checks and the insert.
 */
async function reserveVersion(
  draft: { id: bigint; issueId: bigint },
  issueDate: string,
  options: { confirmRepeat: boolean; service: string; now: Date },
): Promise<Reservation> {
  return prisma.$transaction(async (tx) => {
    await lockIssueDate(tx, issueDate);
    const published = await publishedIssueFor(tx, issueDate);
    if (published) throw new IssuePublishedError(Number(published.id), issueDate);

    const newest = await tx.issueDraft.findFirst({
      where: { issueId: draft.issueId },
      orderBy: { version: "desc" },
      select: { id: true, status: true, content: true, featuredImageUrl: true, scenePrompt: true },
    });
    if (!newest || newest.id !== draft.id) {
      throw new StageError(`Draft ${draft.id} is not the newest draft for ${issueDate}. Reload the page and stage the newest draft.`, "not_current");
    }
    const content = newest.content as unknown as WrittenIssueContent | null;
    const title = typeof content?.title === "string" ? content.title.replace(/\s+/g, " ").trim() : "";
    if (newest.status !== "ready" || !content || !title) {
      const why = newest.status === "ready" ? "has no title" : `is ${newest.status}`;
      throw new StageError(`The draft for ${issueDate} ${why}. Only a ready draft can be staged.`, "not_ready");
    }

    await tx.stagedVersion.deleteMany({
      where: { issueId: draft.issueId, status: "staging", createdAt: { lt: new Date(options.now.getTime() - STAGING_STALE_AFTER_MS) } },
    });
    const last = await tx.stagedVersion.findFirst({
      where: { issueId: draft.issueId },
      orderBy: { version: "desc" },
      select: { version: true, status: true, draftId: true, title: true, featuredImageUrl: true },
    });
    // A staging row always has the highest number: nothing is inserted while one exists.
    if (last?.status === "staging") throw new StageError("Staging is already running.", "staging_running");
    const current = { draftId: Number(draft.id), title, featuredImageUrl: newest.featuredImageUrl };
    if (last && !options.confirmRepeat && !draftChangedSinceStaged(current, { ...last, draftId: Number(last.draftId) })) {
      throw new StageError(`v${last.version} is already staged, and the draft has not changed since.`, "already_staged", last.version);
    }

    const version = (last?.version ?? 0) + 1;
    const row = await tx.stagedVersion.create({
      data: {
        issueId: draft.issueId,
        version,
        draftId: draft.id,
        status: "staging",
        title,
        featuredImageUrl: newest.featuredImageUrl,
        scenePrompt: newest.scenePrompt,
        content: content as unknown as Prisma.InputJsonValue,
        // Set with the real HTML once the service call worked: the HTML carries this row's id.
        html: "",
        service: options.service,
        createdAt: options.now,
      },
      select: { id: true },
    });
    return { id: row.id, issueId: draft.issueId, version, title, content, featuredImageUrl: newest.featuredImageUrl };
  });
}

export async function stageDraft(
  draftId: bigint | number | string,
  options: { confirmRepeat?: boolean } = {},
  deps: StageDraftDeps = {},
): Promise<StagedVersionResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());

  const draft = await prisma.issueDraft.findUnique({ where: { id: BigInt(draftId) }, select: { id: true, issueId: true } });
  if (!draft) throw new StageError(`Draft ${draftId} does not exist.`, "missing");
  const issue = await prisma.issue.findUnique({ where: { id: draft.issueId }, select: { issueDate: true } });
  const issueDate = dateKey(issue?.issueDate ?? null);
  if (!issueDate) throw new StageError(`Draft ${draftId} has no issue date.`, "missing");

  const run: { id: bigint | null } = { id: null };
  /** Run log and incident writes never decide whether the staging worked. */
  const quietly = async (what: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      console.error(`[${STAGE_JOB}] Draft ${draftId}: could not ${what}: ${errorText(error)}`);
    }
  };
  const record = async (entry: SideEffectRecord) => {
    if (run.id === null) return;
    await logEvent(run.id, {
      level: "info",
      step: "stage",
      message: "Not sent outside production. Recorded the call.",
      data: { target: entry.target, action: entry.action, payload: withoutHtml(entry.payload) } as Prisma.InputJsonValue,
    });
  };
  const service = deps.service ?? distributionServiceFromEnv(env, { record });

  const reserved = await reserveVersion(draft, issueDate, { confirmRepeat: options.confirmRepeat === true, service: service.key, now: now() });
  const stats = { draftId: Number(draft.id), stagedVersionId: Number(reserved.id), version: reserved.version, issueDate };
  const incidentKey = stageIncidentKey(issueDate);
  const link = draftsLink(issueDate, env);
  await quietly("start the run log", async () => {
    run.id = await startRun({ job: STAGE_JOB, trigger: "manual" }, now());
  });

  /** Removes the reserved row, writes the failure to the run log, raises the incident, and gives the error to throw. */
  const fail = async (code: "service_failed" | "not_saved", message: string, extra: Record<string, unknown> = {}): Promise<StageError> => {
    // Only the row this call reserved, and only while it is not staged: a staged version is never deleted.
    await quietly("delete the staging row", () => prisma.stagedVersion.deleteMany({ where: { id: reserved.id, status: "staging" } }));
    await quietly("finish the run log", async () => {
      if (run.id !== null) await finishRun(run.id, { status: "failed", error: message, stats: { ...stats, ...extra } }, now());
    });
    await quietly(`raise ${incidentKey}`, () =>
      raiseIncident(
        {
          incidentKey,
          // The owner sees the error on the page at once, and the draft itself is still there.
          severity: "warning",
          what: `Staging v${reserved.version} for ${issueDate} failed.`,
          evidence: message,
          link,
          details: { ...stats, ...extra, runId: run.id === null ? null : String(run.id) },
        },
        { runId: run.id ?? undefined, env, now: now() },
      ),
    );
    return new StageError(message, code);
  };

  let html: string;
  let email: Awaited<ReturnType<DistributionService["createEmail"]>>;
  // Aborted at the timeout, so a call that is still running does not create an email nobody waits for.
  const giveUp = new AbortController();
  try {
    html = renderIssueEmailHtml(
      reserved.content,
      { id: Number(reserved.issueId), issueDate },
      { id: Number(draft.id), featuredImageUrl: reserved.featuredImageUrl ?? "", versionId: Number(reserved.id) },
    );
    const name = stagedEmailName({ issueDate, version: reserved.version, title: reserved.title });
    email = await withTimeout(
      service.createEmail({ name, html, signal: giveUp.signal }),
      deps.timeoutMs ?? STAGE_TIMEOUT_MS,
      `Creating the email in ${service.displayName}`,
    );
  } catch (error) {
    giveUp.abort();
    throw await fail("service_failed", errorText(error));
  }

  // The email exists now. A failed save must not look like a failed service call, or the owner stages again
  // and gets a second email with the same name.
  const stagedAt = now();
  const save = () =>
    prisma.stagedVersion.update({
      where: { id: reserved.id },
      data: { status: "staged", html, service: service.key, serviceRef: email.ref, serviceUrl: email.url, stagedAt },
    });
  try {
    await save().catch(save);
  } catch (error) {
    throw await fail(
      "not_saved",
      `The email was created in ${service.displayName} (${email.ref}), but v${reserved.version} could not be saved: ${errorText(error)} ` +
        `Staging again makes a second email with the same name. Delete ${email.ref} in ${service.displayName} first.`,
      { serviceRef: email.ref },
    );
  }

  await quietly("finish the run log", async () => {
    if (run.id !== null) await finishRun(run.id, { status: "succeeded", stats: { ...stats, mode: email.mode, serviceRef: email.ref } }, now());
  });
  await quietly(`resolve ${incidentKey}`, () =>
    resolveIncident(incidentKey, { runId: run.id ?? undefined, env, now: now(), link, note: `v${reserved.version} is staged.` }),
  );
  return {
    id: Number(reserved.id),
    version: reserved.version,
    issueDate,
    title: reserved.title,
    service: service.key,
    serviceName: service.displayName,
    serviceRef: email.ref,
    serviceUrl: email.url,
    mode: email.mode,
    stagedAt,
  };
}
