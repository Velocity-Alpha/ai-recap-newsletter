import { Prisma } from "@/src/generated/prisma";
import { ISSUE_DRAFT, ISSUE_PUBLISHED } from "@/src/features/newsletter/issue-status";
import { toIssueContentJson, type WrittenIssueContent } from "@/src/pipeline/draft/content";
import { emailImageUrl } from "@/src/pipeline/draft/email-html";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import type { PartialDraft, ProducedDraft } from "@/src/pipeline/draft/produce-draft";
import { finishRun, logEvent, startRun } from "@/src/pipeline/runs";
import { prisma } from "@/src/server/prisma";

/**
 * Issues and their drafts (ADR 0002): one issue per date, and each commit makes the next draft of it.
 * The draft job (run-draft.ts) and the board (#79) read and write drafts only through here.
 */

export type DraftStatus = "running" | "ready" | "failed";

/** A draft in `running` whose attempt started this long ago has died: a background function lives 15 minutes. */
export const STUCK_AFTER_MS = 20 * 60_000;
/** A draft in `running` whose job has not started this long after it was queued never will. */
export const NEVER_STARTED_AFTER_MS = 5 * 60_000;

type Id = bigint | number | string;
type Client = Prisma.TransactionClient;

export class IssuePublishedError extends Error {
  constructor(
    readonly issueId: number,
    readonly issueDate: string,
  ) {
    super(`The issue for ${issueDate} (id ${issueId}) is already published. Drafting stopped.`);
    this.name = "IssuePublishedError";
  }
}

export class DraftNotRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftNotRetryableError";
  }
}

/**
 * "New image" (#116) asked of a draft that does not exist (`missing`), is not ready (`not_ready`), or is not the
 * newest (`not_current`: a newer draft is running or ready, and the new draft would put this one's older text back).
 */
export class NewImageError extends Error {
  constructor(
    message: string,
    readonly reason: "missing" | "not_ready" | "not_current",
  ) {
    super(message);
    this.name = "NewImageError";
  }
}

export interface CreatedDraft {
  draftId: number;
  issueId: number;
  version: number;
  /** YYYY-MM-DD */
  issueDate: string;
}

function day(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateKey(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** The title an issue has until its first draft is ready. `slug` is generated from the title and unique. */
export function placeholderIssueTitle(date: string): string {
  return `AI Recap draft ${date}`;
}

/**
 * A `running` draft whose job died (started over 20 minutes ago) or never started (queued over 5 minutes ago).
 * The board offers "Retry" for these, and `retryDraft` accepts them.
 */
export function isStuckDraft(draft: { status: string; startedAt: Date | null; queuedAt: Date }, now: Date): boolean {
  if (draft.status !== "running") return false;
  if (draft.startedAt) return now.getTime() - draft.startedAt.getTime() > STUCK_AFTER_MS;
  return now.getTime() - draft.queuedAt.getTime() > NEVER_STARTED_AFTER_MS;
}

/**
 * Serialises everything that picks or writes the issue for a date: creating a draft, and copying a ready draft to
 * the issue. The unique index on `issues.issue_date` (#82) backs it up.
 */
async function lockIssueDate(tx: Client, date: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`issue-date:${date}`}))`;
}

/** The date's issue, if it is published. */
async function publishedIssueFor(client: Client, date: string): Promise<{ id: bigint } | null> {
  return client.issue.findFirst({ where: { issueDate: day(date), status: ISSUE_PUBLISHED }, select: { id: true } });
}

/**
 * Finds the outline's issue, or creates it, and adds the next draft as `running`. Never creates a second issue
 * for a date. Throws `IssuePublishedError` if the date's issue is published.
 */
export async function createDraft(outlineId: Id, options: { now?: () => Date } = {}): Promise<CreatedDraft> {
  const now = (options.now ?? (() => new Date()))();
  const outline = await prisma.approvalOutline.findUnique({
    where: { id: BigInt(outlineId) },
    select: { id: true, issueDate: true },
  });
  if (!outline) throw new Error(`Outline ${outlineId} does not exist.`);
  const issueDate = dateKey(outline.issueDate)!;

  return prisma.$transaction(async (tx) => {
    // Two commits for one date: the second waits here, then finds the first one's issue.
    await lockIssueDate(tx, issueDate);

    const issues = await tx.issue.findMany({
      where: { issueDate: day(issueDate) },
      select: { id: true, status: true },
      orderBy: { id: "desc" },
    });
    const published = issues.find((issue) => issue.status === ISSUE_PUBLISHED);
    if (published) throw new IssuePublishedError(Number(published.id), issueDate);

    const issueId =
      issues[0]?.id ??
      (await tx.issue.create({ data: { title: placeholderIssueTitle(issueDate), issueDate: day(issueDate) }, select: { id: true } })).id;

    const last = await tx.issueDraft.findFirst({ where: { issueId }, orderBy: { version: "desc" }, select: { version: true } });
    const version = (last?.version ?? 0) + 1;
    const draft = await tx.issueDraft.create({
      // queuedAt from here, not the column default: retryDraft matches on it, and JS dates have no microseconds.
      data: { issueId, version, outlineId: outline.id, status: "running", queuedAt: now },
      select: { id: true },
    });
    return { draftId: Number(draft.id), issueId: Number(issueId), version, issueDate };
  });
}

/** A ready draft that "New image" (#116) starts from. */
export interface ImageSource {
  draftId: number;
  issueId: number;
  version: number;
  /** YYYY-MM-DD */
  issueDate: string;
  content: WrittenIssueContent;
  featuredImageUrl: string | null;
  scenePrompt: string | null;
}

/**
 * The ready draft "New image" starts from. Throws `NewImageError` when it is missing or not ready, and
 * `IssuePublishedError` when any issue for its date is published.
 */
export async function readImageSource(draftId: Id): Promise<ImageSource> {
  const { source } = await readSourceDraft(draftId);
  await assertNewestDraft(prisma, source);
  return source;
}

/** A draft that is running or ready wins over older drafts when it saves. */
const LIVE_DRAFT_STATUSES: DraftStatus[] = ["running", "ready"];

function newerLiveDraft(client: Client, issueId: bigint, version: number) {
  return client.issueDraft.findFirst({
    where: { issueId, version: { gt: version }, status: { in: LIVE_DRAFT_STATUSES } },
    orderBy: { version: "desc" },
    select: { version: true, status: true },
  });
}

/** "New image" starts only from the newest ready draft, with nothing newer running. */
async function assertNewestDraft(client: Client, source: Pick<ImageSource, "issueId" | "version">): Promise<void> {
  const newer = await newerLiveDraft(client, BigInt(source.issueId), source.version);
  if (newer) {
    throw new NewImageError(
      `Draft v${source.version} is not the newest draft: v${newer.version} is ${newer.status}. Use "New image" on the newest ready draft.`,
      "not_current",
    );
  }
}

async function readSourceDraft(draftId: Id): Promise<{ source: ImageSource; outlineId: bigint }> {
  const draft = await prisma.issueDraft.findUnique({
    where: { id: BigInt(draftId) },
    select: { id: true, issueId: true, version: true, outlineId: true, status: true, content: true, featuredImageUrl: true, scenePrompt: true },
  });
  if (!draft) throw new NewImageError(`Draft ${draftId} does not exist.`, "missing");
  if (draft.status !== "ready" || !draft.content) {
    throw new NewImageError(`Draft ${draftId} is ${draft.status}. Only a ready draft can get a new image.`, "not_ready");
  }
  const issue = await prisma.issue.findUnique({ where: { id: draft.issueId }, select: { issueDate: true } });
  const issueDate = dateKey(issue?.issueDate ?? null);
  if (!issueDate) throw new NewImageError(`Draft ${draftId} has no issue date.`, "missing");
  const published = await publishedIssueFor(prisma, issueDate);
  if (published) throw new IssuePublishedError(Number(published.id), issueDate);
  return {
    outlineId: draft.outlineId,
    source: {
      draftId: Number(draft.id),
      issueId: Number(draft.issueId),
      version: draft.version,
      issueDate,
      content: draft.content as unknown as WrittenIssueContent,
      featuredImageUrl: draft.featuredImageUrl,
      scenePrompt: draft.scenePrompt,
    },
  };
}

/**
 * "Use this image" (#116, ADR 0002): the issue's next draft, with the source draft's written content and the
 * owner's chosen image. The draft job copies the content, so it does not write again, and makes new HTML and a
 * new GHL template. The source draft is not changed. Same published and per-date lock rules as a commit.
 */
export async function createImageDraft(
  sourceDraftId: Id,
  image: { imageUrl: string; scenePrompt: string },
  options: { now?: () => Date } = {},
): Promise<CreatedDraft> {
  const now = (options.now ?? (() => new Date()))();
  const { source, outlineId } = await readSourceDraft(sourceDraftId);

  return prisma.$transaction(async (tx) => {
    await lockIssueDate(tx, source.issueDate);
    const published = await publishedIssueFor(tx, source.issueDate);
    if (published) throw new IssuePublishedError(Number(published.id), source.issueDate);
    // Under the lock, so a commit cannot start a newer draft between this check and the insert.
    await assertNewestDraft(tx, source);

    const issueId = BigInt(source.issueId);
    const last = await tx.issueDraft.findFirst({ where: { issueId }, orderBy: { version: "desc" }, select: { version: true } });
    const version = (last?.version ?? 0) + 1;
    const draft = await tx.issueDraft.create({
      data: {
        issueId,
        version,
        outlineId,
        sourceDraftId: BigInt(source.draftId),
        status: "running",
        queuedAt: now,
        featuredImageUrl: image.imageUrl,
        scenePrompt: image.scenePrompt,
      },
      select: { id: true },
    });
    return { draftId: Number(draft.id), issueId: source.issueId, version, issueDate: source.issueDate };
  });
}

/**
 * Puts a failed draft back to `running`, cleared, so the job runs the same draft (same id and version) again from
 * the start. Start the job afterwards with `startDraftJob`. A stuck draft (`isStuckDraft`) counts as failed.
 */
export async function retryDraft(draftId: Id, options: { now?: () => Date } = {}): Promise<CreatedDraft> {
  const now = (options.now ?? (() => new Date()))();
  const draft = await prisma.issueDraft.findUnique({
    where: { id: BigInt(draftId) },
    select: {
      id: true,
      issueId: true,
      version: true,
      status: true,
      queuedAt: true,
      startedAt: true,
      ghlTemplateId: true,
      ghlPreviewUrl: true,
      sourceDraftId: true,
    },
  });
  if (!draft) throw new DraftNotRetryableError(`Draft ${draftId} does not exist.`);
  const issue = await prisma.issue.findUnique({ where: { id: draft.issueId }, select: { issueDate: true, status: true } });
  const issueDate = dateKey(issue?.issueDate ?? null) ?? "";
  if (issue?.status === ISSUE_PUBLISHED) throw new IssuePublishedError(Number(draft.issueId), issueDate);
  const published = issueDate ? await publishedIssueFor(prisma, issueDate) : null;
  if (published) throw new IssuePublishedError(Number(published.id), issueDate);

  const stuck = isStuckDraft(draft, now);
  if (draft.status === "running" && !stuck) throw new DraftNotRetryableError(`Draft ${draftId} is running now.`);
  if (draft.status !== "failed" && !stuck) {
    throw new DraftNotRetryableError(`Draft ${draftId} is ${draft.status}. Only a failed draft can be retried.`);
  }

  // The retry makes a new GHL template. The old one stays in GHL, so keep its id in the run log.
  if (draft.ghlTemplateId) {
    await logRetriedTemplate({ ...draft, issueDate, ghlTemplateId: draft.ghlTemplateId }, now);
  }

  // Matching on the status and times makes two clicks on "Retry" reset it once.
  const reset = await prisma.issueDraft.updateMany({
    where: { id: draft.id, status: draft.status, queuedAt: draft.queuedAt, startedAt: draft.startedAt },
    data: {
      status: "running",
      currentStep: null,
      failedStep: null,
      error: null,
      content: Prisma.DbNull,
      html: null,
      // A "New image" draft keeps its chosen image: it is the draft's input, not something the job made.
      ...(draft.sourceDraftId === null ? { featuredImageUrl: null, scenePrompt: null } : {}),
      ghlTemplateId: null,
      ghlPreviewUrl: null,
      unreadStoryIds: [],
      queuedAt: now,
      startedAt: null,
      finishedAt: null,
    },
  });
  if (reset.count !== 1) throw new DraftNotRetryableError(`Draft ${draftId} changed while retrying. Reload and try again.`);
  return { draftId: Number(draft.id), issueId: Number(draft.issueId), version: draft.version, issueDate };
}

/** The failed step of a draft whose background function could not be started (it is not one of the job's steps). */
export const DRAFT_START_STEP = "start";

/**
 * Marks a draft failed at `start` when its background function could not be started, so the board can retry it.
 * Only a draft the job has not taken (still `running`, no `started_at`) changes: a job that did start keeps its
 * draft. True when the draft changed.
 */
export async function markDraftStartFailed(draftId: Id, error: string, now: Date): Promise<boolean> {
  const updated = await prisma.issueDraft.updateMany({
    where: { id: BigInt(draftId), status: "running", startedAt: null },
    data: { status: "failed", currentStep: null, failedStep: DRAFT_START_STEP, error, finishedAt: now },
  });
  return updated.count === 1;
}

/** The job name for a retry's run log entry. Not `draft-issue`: a retry does no drafting. */
export const DRAFT_RETRY_JOB = "draft-retry";

async function logRetriedTemplate(
  draft: { id: bigint; version: number; issueDate: string; ghlTemplateId: string; ghlPreviewUrl: string | null },
  now: Date,
): Promise<void> {
  const runId = await startRun({ job: DRAFT_RETRY_JOB, trigger: "manual" }, now);
  const data = {
    draftId: Number(draft.id),
    version: draft.version,
    issueDate: draft.issueDate,
    ghlTemplateId: draft.ghlTemplateId,
    ghlPreviewUrl: draft.ghlPreviewUrl,
  };
  await logEvent(runId, {
    level: "info",
    step: "retry",
    message: `Retrying draft ${draft.id} (v${draft.version} for ${draft.issueDate}). Its old GHL template ${draft.ghlTemplateId} stays in GHL.`,
    data,
  });
  await finishRun(runId, { status: "succeeded", stats: data }, now);
}

// ---- The draft job's reads and writes (run-draft.ts) ----

export interface DraftToRun {
  id: bigint;
  issueId: bigint;
  version: number;
  outlineId: bigint;
  status: string;
  startedAt: Date | null;
  issueDate: string | null;
  /** Set on a "New image" draft (#116): the job copies this draft's content instead of writing. */
  sourceDraftId: bigint | null;
}

export async function findDraftToRun(draftId: Id): Promise<DraftToRun | null> {
  const draft = await prisma.issueDraft.findUnique({
    where: { id: BigInt(draftId) },
    select: { id: true, issueId: true, version: true, outlineId: true, status: true, startedAt: true, sourceDraftId: true },
  });
  if (!draft) return null;
  const issue = await prisma.issue.findUnique({ where: { id: draft.issueId }, select: { issueDate: true } });
  return { ...draft, issueDate: dateKey(issue?.issueDate ?? null) };
}

/**
 * Takes a `running` draft for this attempt. False when another invocation already took it, or it is not running,
 * so a repeated start never runs one draft twice at the same time.
 */
export async function claimDraft(draftId: bigint, now: Date): Promise<boolean> {
  const claimed = await prisma.issueDraft.updateMany({
    where: { id: draftId, status: "running", startedAt: null },
    data: { startedAt: now, currentStep: "load" },
  });
  return claimed.count === 1;
}

export async function setDraftStep(draftId: bigint, step: string): Promise<void> {
  await prisma.issueDraft.update({ where: { id: draftId }, data: { currentStep: step } });
}

/** What the job needs to write: the outline, and the issue it drafts into. */
export async function loadDraftInputs(draft: DraftToRun): Promise<{ outline: ApprovalOutline; issue: { id: number; date: string } }> {
  const outline = await prisma.approvalOutline.findUnique({ where: { id: draft.outlineId }, select: { payload: true } });
  if (!outline) throw new Error(`Outline ${draft.outlineId} does not exist.`);
  const issue = await prisma.issue.findUnique({ where: { id: draft.issueId }, select: { issueDate: true } });
  if (!issue) throw new Error(`Issue ${draft.issueId} does not exist.`);
  const date = dateKey(issue.issueDate);
  if (!date) throw new Error(`Issue ${draft.issueId} has no date.`);
  const published = await publishedIssueFor(prisma, date);
  if (published) throw new IssuePublishedError(Number(published.id), date);
  return { outline: outline.payload as unknown as ApprovalOutline, issue: { id: Number(draft.issueId), date } };
}

/**
 * What a "New image" draft re-uses: its source draft's written content, and the image the owner chose (stored on
 * this draft when it was made). A missing image is left for the job's image step to report.
 */
export async function loadNewImageInputs(
  draft: Pick<DraftToRun, "id" | "issueId" | "sourceDraftId">,
): Promise<{ source: { content: WrittenIssueContent; unreadStoryIds: number[] }; image: { imageUrl: string; scenePrompt: string } }> {
  if (draft.sourceDraftId === null) throw new Error(`Draft ${draft.id} is not a new image draft.`);
  const source = await prisma.issueDraft.findUnique({
    where: { id: draft.sourceDraftId },
    select: { issueId: true, status: true, content: true, unreadStoryIds: true },
  });
  if (!source || source.issueId !== draft.issueId) {
    throw new Error(`Draft ${draft.sourceDraftId}, which this new image draft copies, is not a draft of the same issue.`);
  }
  if (source.status !== "ready" || !source.content) {
    throw new Error(`Draft ${draft.sourceDraftId}, which this new image draft copies, is ${source.status}, not ready.`);
  }
  const own = await prisma.issueDraft.findUnique({ where: { id: draft.id }, select: { featuredImageUrl: true, scenePrompt: true } });
  return {
    source: { content: source.content as unknown as WrittenIssueContent, unreadStoryIds: source.unreadStoryIds },
    image: { imageUrl: own?.featuredImageUrl ?? "", scenePrompt: own?.scenePrompt ?? "" },
  };
}

export type IssueUpdate = "updated" | "newer_draft" | "published";

/**
 * Marks the draft ready and, in the same transaction, copies it to the issue row, so the site and publish
 * detection read it as before. The issue keeps a newer ready draft, and nothing changes once any issue for the
 * date is published.
 */
export async function saveReadyDraft(
  draft: DraftToRun & { issueDate: string },
  produced: ProducedDraft,
  now: Date,
): Promise<IssueUpdate> {
  return prisma.$transaction(async (tx) => {
    // Two drafts finishing together: the second waits here, so it sees the first one's ready row below.
    await lockIssueDate(tx, draft.issueDate);
    await tx.issueDraft.update({
      where: { id: draft.id },
      data: {
        status: "ready",
        currentStep: null,
        finishedAt: now,
        content: produced.content as unknown as Prisma.InputJsonValue,
        html: produced.html,
        featuredImageUrl: produced.featuredImageUrl,
        scenePrompt: produced.scenePrompt,
        ghlTemplateId: produced.ghlTemplateId,
        ghlPreviewUrl: produced.ghlPreviewUrl,
        unreadStoryIds: produced.unreadStoryIds,
      },
    });

    const newer = await tx.issueDraft.count({ where: { issueId: draft.issueId, version: { gt: draft.version }, status: "ready" } });
    if (newer > 0) return "newer_draft";
    if (await publishedIssueFor(tx, draft.issueDate)) return "published";

    const updated = await tx.issue.updateMany({
      where: { id: draft.issueId, status: ISSUE_DRAFT },
      data: issueFields(produced, { issueId: Number(draft.issueId), issueDate: draft.issueDate }),
    });
    return updated.count === 1 ? "updated" : "published";
  });
}

/** The issue columns a ready draft sets. `slug` is generated from the title. */
export function issueFields(produced: Pick<ProducedDraft, "content" | "html" | "featuredImageUrl" | "scenePrompt">, meta: { issueId: number; issueDate: string }) {
  const content: WrittenIssueContent = produced.content;
  return {
    title: content.title,
    html: produced.html,
    featureImageUrl: produced.featuredImageUrl,
    promptFeaturedImage: produced.scenePrompt,
    excerpt: content.excerpt,
    contentJson: toIssueContentJson(content, {
      issueId: meta.issueId,
      issueDate: meta.issueDate,
      featuredImageUrl: emailImageUrl(produced.featuredImageUrl),
    }) as unknown as Prisma.InputJsonValue,
  };
}

/**
 * The issue columns for the draft a sent email carried, so the archive shows the version that was sent, not the
 * newest one. Null when the draft is not this issue's or has no email yet: publishing then works as before.
 */
export async function sentDraftIssueFields(client: Client, issueId: number, draftId: number) {
  const draft = await client.issueDraft.findUnique({
    where: { id: BigInt(draftId) },
    select: { issueId: true, content: true, html: true, featuredImageUrl: true, scenePrompt: true },
  });
  if (!draft || draft.issueId !== BigInt(issueId) || !draft.content || !draft.html || !draft.featuredImageUrl || !draft.scenePrompt) {
    return null;
  }
  const issue = await client.issue.findUnique({ where: { id: BigInt(issueId) }, select: { issueDate: true } });
  const issueDate = dateKey(issue?.issueDate ?? null);
  if (!issueDate) return null;
  const { html, featuredImageUrl, scenePrompt } = draft;
  return issueFields({ content: draft.content as unknown as WrittenIssueContent, html, featuredImageUrl, scenePrompt }, { issueId, issueDate });
}

/** Marks the draft failed at a step, keeping what it made before the step, so the owner can see it. */
export async function saveFailedDraft(
  draftId: bigint,
  failure: { step: string; error: string; partial?: PartialDraft },
  now: Date,
): Promise<void> {
  const partial = failure.partial ?? {};
  await prisma.issueDraft.update({
    where: { id: draftId },
    data: {
      status: "failed",
      currentStep: null,
      failedStep: failure.step,
      error: failure.error,
      finishedAt: now,
      ...(partial.content ? { content: partial.content as unknown as Prisma.InputJsonValue } : {}),
      ...(partial.html ? { html: partial.html } : {}),
      ...(partial.featuredImageUrl ? { featuredImageUrl: partial.featuredImageUrl } : {}),
      ...(partial.scenePrompt ? { scenePrompt: partial.scenePrompt } : {}),
      ...(partial.unreadStoryIds ? { unreadStoryIds: partial.unreadStoryIds } : {}),
      ...(partial.ghlTemplateId ? { ghlTemplateId: partial.ghlTemplateId } : {}),
      ...(partial.ghlPreviewUrl ? { ghlPreviewUrl: partial.ghlPreviewUrl } : {}),
    },
  });
}

// ---- Reads for the board (#79) ----

export interface DraftView {
  id: number;
  issueId: number;
  /** YYYY-MM-DD */
  issueDate: string | null;
  version: number;
  status: DraftStatus;
  /** The step running now (load, read_articles, write, validate, image, html, ghl, save), else null. */
  currentStep: string | null;
  failedStep: string | null;
  /** Plain words, for the board. */
  error: string | null;
  /** The written title, once the writer has run. */
  subject: string | null;
  hasHtml: boolean;
  ghlTemplateId: string | null;
  ghlPreviewUrl: string | null;
  /** Feature-section stories whose article was not read ("source not read"). */
  unreadStoryIds: number[];
  createdAt: Date;
  /** When it last waited for its job (create or retry). */
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  featuredImageUrl: string | null;
  scenePrompt: string | null;
  /** A "New image" draft (#116): the draft whose content it re-uses, and that draft's version. */
  sourceDraftId: number | null;
  sourceVersion: number | null;
  /** Any issue row for the date is published, so nothing more can be drafted. */
  issuePublished: boolean;
  /** A newer draft of the issue is running or ready, so "New image" cannot start from this one. */
  hasNewerDraft: boolean;
}

export interface DraftListItem extends DraftView {
  /** A sent email carried this draft's id (publish_events.draft_id). */
  sent: boolean;
  /** The newest ready draft: the one the issue row holds. */
  current: boolean;
}

const VIEW_SELECT = {
  id: true,
  issueId: true,
  version: true,
  status: true,
  currentStep: true,
  failedStep: true,
  error: true,
  content: true,
  html: true,
  ghlTemplateId: true,
  ghlPreviewUrl: true,
  unreadStoryIds: true,
  createdAt: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  featuredImageUrl: true,
  scenePrompt: true,
  sourceDraftId: true,
} as const;

type ViewRow = Prisma.IssueDraftGetPayload<{ select: typeof VIEW_SELECT }>;

function subjectOf(content: unknown): string | null {
  const title = (content as { title?: unknown } | null)?.title;
  return typeof title === "string" && title.trim() ? title : null;
}

function toView(
  row: ViewRow,
  issueDate: string | null,
  extra: Pick<DraftView, "issuePublished" | "sourceVersion" | "hasNewerDraft">,
): DraftView {
  return {
    id: Number(row.id),
    issueId: Number(row.issueId),
    issueDate,
    version: row.version,
    status: row.status as DraftStatus,
    currentStep: row.currentStep,
    failedStep: row.failedStep,
    error: row.error,
    subject: subjectOf(row.content),
    hasHtml: Boolean(row.html),
    ghlTemplateId: row.ghlTemplateId,
    ghlPreviewUrl: row.ghlPreviewUrl,
    unreadStoryIds: row.unreadStoryIds,
    createdAt: row.createdAt,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    featuredImageUrl: row.featuredImageUrl,
    scenePrompt: row.scenePrompt,
    sourceDraftId: row.sourceDraftId === null ? null : Number(row.sourceDraftId),
    sourceVersion: extra.sourceVersion,
    issuePublished: extra.issuePublished,
    hasNewerDraft: extra.hasNewerDraft,
  };
}

/** Every draft for a date (YYYY-MM-DD), newest first. */
export async function listDraftsForDate(date: string): Promise<DraftListItem[]> {
  const issues = await prisma.issue.findMany({ where: { issueDate: day(date) }, select: { id: true, status: true } });
  if (issues.length === 0) return [];
  const issuePublished = issues.some((issue) => issue.status === ISSUE_PUBLISHED);
  const rows = await prisma.issueDraft.findMany({
    where: { issueId: { in: issues.map((issue) => issue.id) } },
    orderBy: [{ version: "desc" }, { id: "desc" }],
    select: VIEW_SELECT,
  });
  if (rows.length === 0) return [];

  const sentRows = await prisma.publishEvent.findMany({
    where: { draftId: { in: rows.map((row) => row.id) } },
    select: { draftId: true },
  });
  const sent = new Set(sentRows.map((row) => String(row.draftId)));
  const current = rows.find((row) => row.status === "ready")?.id;
  const versions = new Map(rows.map((row) => [String(row.id), row.version]));
  return rows.map((row) => ({
    ...toView(row, date, {
      issuePublished,
      sourceVersion: row.sourceDraftId === null ? null : (versions.get(String(row.sourceDraftId)) ?? null),
      hasNewerDraft: rows.some(
        (other) => other.issueId === row.issueId && other.version > row.version && LIVE_DRAFT_STATUSES.includes(other.status as DraftStatus),
      ),
    }),
    sent: sent.has(String(row.id)),
    current: row.id === current,
  }));
}

/** One draft's status, for the board's live progress. Null when there is no such draft. */
export async function getDraftStatus(draftId: Id): Promise<DraftView | null> {
  const row = await prisma.issueDraft.findUnique({ where: { id: BigInt(draftId) }, select: VIEW_SELECT });
  if (!row) return null;
  const issue = await prisma.issue.findUnique({ where: { id: row.issueId }, select: { issueDate: true } });
  const issueDate = dateKey(issue?.issueDate ?? null);
  const published = issueDate ? await publishedIssueFor(prisma, issueDate) : null;
  const source =
    row.sourceDraftId === null ? null : await prisma.issueDraft.findUnique({ where: { id: row.sourceDraftId }, select: { version: true } });
  const newer = await newerLiveDraft(prisma, row.issueId, row.version);
  return toView(row, issueDate, { issuePublished: Boolean(published), sourceVersion: source?.version ?? null, hasNewerDraft: Boolean(newer) });
}

/** The draft's email HTML, for the board's preview frame. */
export async function getDraftHtml(draftId: Id): Promise<string | null> {
  const row = await prisma.issueDraft.findUnique({ where: { id: BigInt(draftId) }, select: { html: true } });
  return row?.html ?? null;
}
