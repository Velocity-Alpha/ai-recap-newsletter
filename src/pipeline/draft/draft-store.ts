import { Prisma } from "@/src/generated/prisma";
import { toIssueContentJson, type WrittenIssueContent } from "@/src/pipeline/draft/content";
import { emailImageUrl } from "@/src/pipeline/draft/email-html";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import { readDraftOwner } from "@/src/pipeline/draft/outline-store";
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

export class DraftOwnerError extends Error {
  constructor() {
    super("draft.owner is n8n, so native drafting is off.");
    this.name = "DraftOwnerError";
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
 * the issue. Until #82 adds a unique index on the date, this is what keeps one issue per date.
 */
async function lockIssueDate(tx: Client, date: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`issue-date:${date}`}))`;
}

/** Any published issue for the date. n8n could leave several issue rows for one date, so check them all. */
async function publishedIssueFor(client: Client, date: string): Promise<{ id: bigint } | null> {
  return client.issue.findFirst({ where: { issueDate: day(date), publishedAt: { not: null } }, select: { id: true } });
}

/**
 * Finds the outline's issue, or creates it, and adds the next draft as `running`. Never creates a second issue
 * for a date. When n8n left several, it uses the latest unpublished one. Throws `DraftOwnerError` unless
 * `draft.owner` is native, and `IssuePublishedError` if any issue for the date is published.
 */
export async function createDraft(outlineId: Id, options: { now?: () => Date } = {}): Promise<CreatedDraft> {
  const now = (options.now ?? (() => new Date()))();
  if ((await readDraftOwner()) !== "native") throw new DraftOwnerError();
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
      select: { id: true, publishedAt: true },
      orderBy: { id: "desc" },
    });
    const published = issues.find((issue) => issue.publishedAt);
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

/**
 * Puts a failed draft back to `running`, cleared, so the job runs the same draft (same id and version) again from
 * the start. Start the job afterwards with `startDraftJob`. A stuck draft (`isStuckDraft`) counts as failed.
 */
export async function retryDraft(draftId: Id, options: { now?: () => Date } = {}): Promise<CreatedDraft> {
  const now = (options.now ?? (() => new Date()))();
  const draft = await prisma.issueDraft.findUnique({
    where: { id: BigInt(draftId) },
    select: { id: true, issueId: true, version: true, status: true, queuedAt: true, startedAt: true, ghlTemplateId: true, ghlPreviewUrl: true },
  });
  if (!draft) throw new DraftNotRetryableError(`Draft ${draftId} does not exist.`);
  const issue = await prisma.issue.findUnique({ where: { id: draft.issueId }, select: { issueDate: true, publishedAt: true } });
  const issueDate = dateKey(issue?.issueDate ?? null) ?? "";
  if (issue?.publishedAt) throw new IssuePublishedError(Number(draft.issueId), issueDate);
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
      featuredImageUrl: null,
      scenePrompt: null,
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
}

export async function findDraftToRun(draftId: Id): Promise<DraftToRun | null> {
  const draft = await prisma.issueDraft.findUnique({
    where: { id: BigInt(draftId) },
    select: { id: true, issueId: true, version: true, outlineId: true, status: true, startedAt: true },
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
  const issue = await prisma.issue.findUnique({ where: { id: draft.issueId }, select: { issueDate: true, publishedAt: true } });
  if (!issue) throw new Error(`Issue ${draft.issueId} does not exist.`);
  const date = dateKey(issue.issueDate);
  if (!date) throw new Error(`Issue ${draft.issueId} has no date.`);
  const published = await publishedIssueFor(prisma, date);
  if (published) throw new IssuePublishedError(Number(published.id), date);
  return { outline: outline.payload as unknown as ApprovalOutline, issue: { id: Number(draft.issueId), date } };
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
      where: { id: draft.issueId, publishedAt: null },
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
} as const;

type ViewRow = Prisma.IssueDraftGetPayload<{ select: typeof VIEW_SELECT }>;

function subjectOf(content: unknown): string | null {
  const title = (content as { title?: unknown } | null)?.title;
  return typeof title === "string" && title.trim() ? title : null;
}

function toView(row: ViewRow, issueDate: string | null): DraftView {
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
  };
}

/** Every draft for a date (YYYY-MM-DD), newest first. */
export async function listDraftsForDate(date: string): Promise<DraftListItem[]> {
  const issues = await prisma.issue.findMany({ where: { issueDate: day(date) }, select: { id: true } });
  if (issues.length === 0) return [];
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
  return rows.map((row) => ({ ...toView(row, date), sent: sent.has(String(row.id)), current: row.id === current }));
}

/** One draft's status, for the board's live progress. Null when there is no such draft. */
export async function getDraftStatus(draftId: Id): Promise<DraftView | null> {
  const row = await prisma.issueDraft.findUnique({ where: { id: BigInt(draftId) }, select: VIEW_SELECT });
  if (!row) return null;
  const issue = await prisma.issue.findUnique({ where: { id: row.issueId }, select: { issueDate: true } });
  return toView(row, dateKey(issue?.issueDate ?? null));
}

/** The draft's email HTML, for the board's preview frame. */
export async function getDraftHtml(draftId: Id): Promise<string | null> {
  const row = await prisma.issueDraft.findUnique({ where: { id: BigInt(draftId) }, select: { html: true } });
  return row?.html ?? null;
}
