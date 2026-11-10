/** Board-side helpers for drafts (#79). Safe for client components. */

import type { DateDraftsView } from "@/src/pipeline/draft/draft-board";

/** What the commit dialog needs to know about the date's drafts. */
type DraftingSummary = Pick<DateDraftsView, "currentDraft">;

export function draftViewHref(date: string, draftId?: number): string {
  const params = new URLSearchParams({ date });
  if (draftId !== undefined) params.set("draft", String(draftId));
  return `/approval/drafts?${params}`;
}

/**
 * The link from an older draft's page to the date's current draft. Null when the page already shows the
 * current draft, or the date has none.
 */
export function currentDraftHref(date: string, currentDraftId: number | null | undefined, shownId: number | null): string | null {
  if (typeof currentDraftId !== "number" || currentDraftId === shownId) return null;
  return draftViewHref(date);
}

export function draftHtmlSrc(draftId: number): string {
  return `/api/approval/drafts/${draftId}/html`;
}

/**
 * Fetch options for a write to the approval API. Always JSON, even with no body: the Origin check (#128)
 * answers a write without `Content-Type: application/json` with 415.
 */
export function jsonPost(body: unknown = {}): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/**
 * A title as it is stored: one line of plain text, where runs of white space (line breaks too) become one space.
 * The server cleans a new title with it, and the title field compares with it.
 */
export function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

/**
 * A call to the approval API that failed. `status` is the HTTP status, or null when the server was not reached.
 * The message is plain, for the page to show as is.
 */
export class DraftRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "DraftRequestError";
  }
}

/**
 * The server refused because the draft is not what the page shows (409): the issue is published, a newer draft
 * exists, or the draft is not ready. The page then reads the draft again.
 */
export function isRefusal(error: unknown): boolean {
  return error instanceof DraftRequestError && error.status === 409;
}

const EDITS_REPLACED_NOTICE = "This replaces the current draft, including your title and image changes.";

/** Shown before a commit when the date already has a draft. It never gives a draft row's number (#149). */
export function secondCommitNotice(drafting: DraftingSummary | null): string | null {
  if (!drafting?.currentDraft) return null;
  return drafting.currentDraft.edited
    ? `This makes a new draft. ${EDITS_REPLACED_NOTICE}`
    : "This makes a new draft. It replaces the current draft as the one to review and stage.";
}

/**
 * Where the board goes after a commit: the new draft's view when the commit made one (also when its job did not
 * start, so the owner sees the failure and "Retry"). Null otherwise.
 */
export function nativeCommitTarget(body: unknown, date: string): string | null {
  const draftId = (body as { draft?: { draftId?: unknown } } | null)?.draft?.draftId;
  return typeof draftId === "number" ? draftViewHref(date, draftId) : null;
}
