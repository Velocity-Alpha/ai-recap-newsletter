import { Prisma } from "@/src/generated/prisma";
import { ISSUE_DRAFT, ISSUE_PUBLISHED } from "@/src/features/newsletter/issue-status";
import { toIssueContentJson, type WrittenIssueContent } from "@/src/pipeline/draft/content";
import { emailImageUrl, renderIssueEmailHtml } from "@/src/pipeline/draft/email-html";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import type { PartialDraft, ProducedDraft } from "@/src/pipeline/draft/produce-draft";
import { prisma } from "@/src/server/prisma";

/**
 * Issues and their drafts (ADR 0005): one issue per date, and each commit makes the next draft of it. A title or
 * image change edits the newest draft in place. The draft job (run-draft.ts) and the board (#79) read and write
 * drafts only through here.
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
    super(`The issue for ${issueDate} (id ${issueId}) is already published.`);
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
 * A title or image change (#149) asked of a draft that does not exist (`missing`), is not the issue's newest draft
 * (`not_current`), or is not ready (`not_ready`), or a new title that another issue already has (`title_taken`).
 */
export class DraftEditError extends Error {
  constructor(
    message: string,
    readonly reason: "missing" | "not_ready" | "not_current" | "title_taken",
  ) {
    super(message);
    this.name = "DraftEditError";
  }
}

/** `issues.slug` comes from the title and is unique, so two issues cannot have one title. */
export function titleTakenMessage(title: string, next: string): string {
  return `Another issue already uses the title "${title}", and titles must be unique. ${next}`;
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

export function dateKey(value: Date | null): string | null {
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
export async function lockIssueDate(tx: Client, date: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`issue-date:${date}`}))`;
}

/** The date's issue, if it is published. */
export async function publishedIssueFor(client: Client, date: string): Promise<{ id: bigint } | null> {
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

/** The issue's current draft: its newest draft, when that draft is ready. Only it can be changed or staged. */
export interface CurrentDraft {
  draftId: number;
  issueId: number;
  version: number;
  /** YYYY-MM-DD */
  issueDate: string;
  content: WrittenIssueContent;
  featuredImageUrl: string | null;
  scenePrompt: string | null;
}

async function findDraftWithDate(draftId: Id): Promise<{ id: bigint; issueId: bigint; version: number; issueDate: string }> {
  const draft = await prisma.issueDraft.findUnique({ where: { id: BigInt(draftId) }, select: { id: true, issueId: true, version: true } });
  if (!draft) throw new DraftEditError(`Draft ${draftId} does not exist.`, "missing");
  const issue = await prisma.issue.findUnique({ where: { id: draft.issueId }, select: { issueDate: true } });
  const issueDate = dateKey(issue?.issueDate ?? null);
  if (!issueDate) throw new DraftEditError(`Draft ${draftId} has no issue date.`, "missing");
  return { ...draft, issueDate };
}

/**
 * The draft as the issue's current draft. Throws `IssuePublishedError` when any issue for the date is published,
 * and `DraftEditError` when a newer draft exists (`not_current`) or the draft is not ready (`not_ready`).
 */
async function currentDraftOf(client: Client, draft: { id: bigint; issueId: bigint; version: number; issueDate: string }): Promise<CurrentDraft> {
  const published = await publishedIssueFor(client, draft.issueDate);
  if (published) throw new IssuePublishedError(Number(published.id), draft.issueDate);

  const newest = await client.issueDraft.findFirst({
    where: { issueId: draft.issueId },
    orderBy: { version: "desc" },
    select: { id: true, status: true, content: true, featuredImageUrl: true, scenePrompt: true },
  });
  // The messages name no draft number: the owner sees only staged version numbers (#149).
  if (!newest || newest.id !== draft.id) {
    throw new DraftEditError(`This is not the newest draft for ${draft.issueDate}. Reload the page.`, "not_current");
  }
  if (newest.status !== "ready" || !newest.content) {
    throw new DraftEditError(`The draft for ${draft.issueDate} is ${newest.status}. Only a ready draft can be changed.`, "not_ready");
  }
  return {
    draftId: Number(draft.id),
    issueId: Number(draft.issueId),
    version: draft.version,
    issueDate: draft.issueDate,
    content: newest.content as unknown as WrittenIssueContent,
    featuredImageUrl: newest.featuredImageUrl,
    scenePrompt: newest.scenePrompt,
  };
}

/** The current draft, for "New image" ideas and "Generate". Throws as `editCurrentDraft` does. */
export async function readCurrentDraft(draftId: Id): Promise<CurrentDraft> {
  return currentDraftOf(prisma, await findDraftWithDate(draftId));
}

export type DraftEdit = { title: string } | { image: { imageUrl: string; scenePrompt: string } };

/**
 * Changes the current draft's title or image in place (#149, ADR 0005): the same draft row, with its email HTML
 * built again, and the issue row updated in the same transaction. It makes no new draft and calls no outside
 * service. A staged version keeps its own copy, so it does not change. Same published and per-date lock rules
 * as a commit. The caller gives a clean title (draft-edit.ts) or an image it has checked (new-image.ts).
 */
export async function editCurrentDraft(draftId: Id, edit: DraftEdit, options: { now?: () => Date } = {}): Promise<CurrentDraft> {
  const now = (options.now ?? (() => new Date()))();
  const draft = await findDraftWithDate(draftId);

  try {
    return await prisma.$transaction(async (tx) => {
      // Under the lock, so a commit or a staging cannot slip in between the checks and the write.
      await lockIssueDate(tx, draft.issueDate);
      const current = await currentDraftOf(tx, draft);

      const content: WrittenIssueContent = "title" in edit ? { ...current.content, title: edit.title } : current.content;
      // A draft with no image or scene prompt keeps null: a title change does not write "" in its place.
      const featuredImageUrl = "image" in edit ? edit.image.imageUrl : current.featuredImageUrl;
      const scenePrompt = "image" in edit ? edit.image.scenePrompt : current.scenePrompt;
      const html = renderIssueEmailHtml(
        content,
        { id: current.issueId, issueDate: current.issueDate },
        { id: current.draftId, featuredImageUrl: featuredImageUrl ?? "" },
      );

      await tx.issueDraft.update({
        where: { id: draft.id },
        data: { content: content as unknown as Prisma.InputJsonValue, html, featuredImageUrl, scenePrompt, editedAt: now },
      });
      const updated = await tx.issue.updateMany({
        where: { id: draft.issueId, status: ISSUE_DRAFT },
        data: issueFields({ content, html, featuredImageUrl, scenePrompt }, { issueId: current.issueId, issueDate: current.issueDate }),
      });
      if (updated.count !== 1) throw new IssuePublishedError(current.issueId, current.issueDate);
      return { ...current, content, featuredImageUrl, scenePrompt };
    });
  } catch (error) {
    // The failed write undid the whole transaction, so the draft still has its old title.
    if ((error as { code?: unknown } | null)?.code === "P2002" && "title" in edit) {
      throw new DraftEditError(titleTakenMessage(edit.title, "Use a different title."), "title_taken");
    }
    throw error;
  }
}

/**
 * Puts a failed draft back to `running`, cleared, so the job runs the same draft (same id and version) again from
 * the start. Start the job afterwards with `startDraftJob`. A stuck draft (`isStuckDraft`) counts as failed.
 */
export async function retryDraft(draftId: Id, options: { now?: () => Date } = {}): Promise<CreatedDraft> {
  const now = (options.now ?? (() => new Date()))();
  const draft = await prisma.issueDraft.findUnique({
    where: { id: BigInt(draftId) },
    select: { id: true, issueId: true, version: true, status: true, queuedAt: true, startedAt: true },
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
      unreadStoryIds: [],
      editedAt: null,
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
  const issue = await prisma.issue.findUnique({ where: { id: draft.issueId }, select: { issueDate: true } });
  if (!issue) throw new Error(`Issue ${draft.issueId} does not exist.`);
  const date = dateKey(issue.issueDate);
  if (!date) throw new Error(`Issue ${draft.issueId} has no date.`);
  const published = await publishedIssueFor(prisma, date);
  if (published) throw new IssuePublishedError(Number(published.id), date);
  return { outline: outline.payload as unknown as ApprovalOutline, issue: { id: Number(draft.issueId), date } };
}

export type IssueUpdate = "updated" | "newer_draft" | "published";

export interface ReadyDraftSave {
  /** What happened to the issue row. */
  issue: IssueUpdate;
  /** No newer draft of any status exists for the issue, so this is the draft to review. */
  newest: boolean;
}

/**
 * Marks the draft ready and, in the same transaction, copies it to the issue row, so the site and publish
 * detection read it as before. The issue keeps a newer ready draft, and nothing changes once any issue for the
 * date is published. A newer draft that is running or failed does not stop the copy, but then this draft is not
 * the `newest`.
 */
export async function saveReadyDraft(
  draft: DraftToRun & { issueDate: string },
  produced: ProducedDraft,
  now: Date,
): Promise<ReadyDraftSave> {
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
        unreadStoryIds: produced.unreadStoryIds,
      },
    });

    // createDraft takes the same lock, so no newer draft can appear between this read and the commit.
    const newerDrafts = await tx.issueDraft.findMany({
      where: { issueId: draft.issueId, version: { gt: draft.version } },
      select: { status: true },
    });
    const newest = newerDrafts.length === 0;
    if (newerDrafts.some((newer) => newer.status === "ready")) return { issue: "newer_draft", newest };
    if (await publishedIssueFor(tx, draft.issueDate)) return { issue: "published", newest };

    const updated = await tx.issue.updateMany({
      where: { id: draft.issueId, status: ISSUE_DRAFT },
      data: issueFields(produced, { issueId: Number(draft.issueId), issueDate: draft.issueDate }),
    });
    return { issue: updated.count === 1 ? "updated" : "published", newest };
  });
}

/** What a draft gives the issue row. The image and its scene prompt are null on a draft that has none. */
type IssueSource = Pick<ProducedDraft, "content" | "html"> & { featuredImageUrl: string | null; scenePrompt: string | null };

/** The issue columns a ready draft sets. `slug` is generated from the title. */
export function issueFields(produced: IssueSource, meta: { issueId: number; issueDate: string }) {
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
      featuredImageUrl: emailImageUrl(produced.featuredImageUrl ?? ""),
    }) as unknown as Prisma.InputJsonValue,
  };
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
  /** The step running now (load, read_articles, write, validate, image, html, save), else null. */
  currentStep: string | null;
  failedStep: string | null;
  /** Plain words, for the board. */
  error: string | null;
  /** The written title, once the writer has run. */
  subject: string | null;
  hasHtml: boolean;
  /** Feature-section stories whose article was not read ("source not read"). */
  unreadStoryIds: number[];
  createdAt: Date;
  /** When it last waited for its job (create or retry). */
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  featuredImageUrl: string | null;
  scenePrompt: string | null;
  /** When the owner last changed the title or the image. Null when the draft is as the job made it. */
  editedAt: Date | null;
  /** Any issue row for the date is published, so nothing more can be drafted. */
  issuePublished: boolean;
  /** The issue has a newer draft, so this one can no longer be changed or staged. */
  hasNewerDraft: boolean;
}

export interface DraftListItem extends DraftView {
  /** A sent email carried this draft's id (publish_events.draft_id). */
  sent: boolean;
  /** The issue's current draft (`CurrentDraft`): its newest draft, and only when that draft is ready. */
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
  unreadStoryIds: true,
  createdAt: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  featuredImageUrl: true,
  scenePrompt: true,
  editedAt: true,
} as const;

type ViewRow = Prisma.IssueDraftGetPayload<{ select: typeof VIEW_SELECT }>;

function subjectOf(content: unknown): string | null {
  const title = (content as { title?: unknown } | null)?.title;
  return typeof title === "string" && title.trim() ? title : null;
}

function toView(
  row: ViewRow,
  issueDate: string | null,
  extra: Pick<DraftView, "issuePublished" | "hasNewerDraft">,
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
    unreadStoryIds: row.unreadStoryIds,
    createdAt: row.createdAt,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    featuredImageUrl: row.featuredImageUrl,
    scenePrompt: row.scenePrompt,
    editedAt: row.editedAt,
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
  return rows.map((row) => {
    const hasNewerDraft = rows.some((other) => other.issueId === row.issueId && other.version > row.version);
    return {
      ...toView(row, date, { issuePublished, hasNewerDraft }),
      sent: sent.has(String(row.id)),
      current: row.status === "ready" && !hasNewerDraft,
    };
  });
}

/** One draft's status, for the board's live progress. Null when there is no such draft. */
export async function getDraftStatus(draftId: Id): Promise<DraftView | null> {
  const row = await prisma.issueDraft.findUnique({ where: { id: BigInt(draftId) }, select: VIEW_SELECT });
  if (!row) return null;
  const issue = await prisma.issue.findUnique({ where: { id: row.issueId }, select: { issueDate: true } });
  const issueDate = dateKey(issue?.issueDate ?? null);
  const published = issueDate ? await publishedIssueFor(prisma, issueDate) : null;
  const newer = await prisma.issueDraft.count({ where: { issueId: row.issueId, version: { gt: row.version } } });
  return toView(row, issueDate, { issuePublished: Boolean(published), hasNewerDraft: newer > 0 });
}

/** The draft's email HTML, for the board's preview frame. */
export async function getDraftHtml(draftId: Id): Promise<string | null> {
  const row = await prisma.issueDraft.findUnique({ where: { id: BigInt(draftId) }, select: { html: true } });
  return row?.html ?? null;
}
