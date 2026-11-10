/** Board-side helpers for drafts (#79). Safe for client components. */

export interface DraftingSummary {
  /** Newest first. */
  drafts: { id: number; version: number; status: string }[];
  nextVersion: number;
}

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

/** Shown before a commit when the date already has drafts. */
export function secondCommitNotice(drafting: DraftingSummary | null): string | null {
  if (!drafting || drafting.drafts.length === 0) return null;
  return `This makes draft v${drafting.nextVersion} and a new GHL template. Earlier drafts stay in GHL.`;
}

/**
 * Where the board goes after a commit: the new draft's view when the commit made one (also when its job did not
 * start, so the owner sees the failure and "Retry"). Null otherwise.
 */
export function nativeCommitTarget(body: unknown, date: string): string | null {
  const draftId = (body as { draft?: { draftId?: unknown } } | null)?.draft?.draftId;
  return typeof draftId === "number" ? draftViewHref(date, draftId) : null;
}
