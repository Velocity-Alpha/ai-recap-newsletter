/** Board-side helpers for drafts (#79). Safe for client components. */

import type { DateDraftsView } from "@/src/pipeline/draft/draft-board";

/** What the commit dialog needs to know about the date's drafts. */
export type DraftingSummary = Pick<DateDraftsView, "currentDraft">;

export function draftViewHref(date: string, draftId?: number): string {
  const params = new URLSearchParams({ date });
  if (draftId !== undefined) params.set("draft", String(draftId));
  return `/approval/drafts?${params}`;
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

export const EDITS_REPLACED_NOTICE = "This replaces the current draft, including your title and image changes.";

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
