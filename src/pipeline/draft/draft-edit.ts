import { DraftEditError, editCurrentDraft, IssuePublishedError, type CurrentDraft } from "@/src/pipeline/draft/draft-store";

/**
 * The owner's title change on the draft view (#149, ADR 0004), and the HTTP answers for a draft that cannot be
 * changed. The title is the email's subject line and the issue's title on the site. `PATCH
 * /api/approval/drafts/[id]` calls this; the image change is in new-image.ts.
 */

/** Longer than any subject line an inbox shows. It stops a pasted paragraph. */
export const MAX_TITLE_CHARS = 200;

/** The request is not usable (400). */
export class DraftTitleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftTitleError";
  }
}

/** One line of plain text: runs of white space (line breaks too) become one space. */
export function cleanTitle(value: unknown): string {
  if (typeof value !== "string") throw new DraftTitleError("Send the new title.");
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) throw new DraftTitleError("The title is empty. Write a title first.");
  if (title.length > MAX_TITLE_CHARS) {
    throw new DraftTitleError(`The title is ${title.length} characters. Keep it to ${MAX_TITLE_CHARS} or fewer.`);
  }
  return title;
}

/**
 * Puts the new title into the current draft and the issue. Throws `DraftTitleError` for an unusable title,
 * `DraftEditError` when the draft cannot be changed or another issue has the title, and `IssuePublishedError`
 * once the date's issue is published.
 */
export async function changeDraftTitle(draftId: number, body: unknown, options: { now?: () => Date } = {}): Promise<CurrentDraft> {
  const title = cleanTitle((body as { title?: unknown } | null)?.title);
  return editCurrentDraft(draftId, { title }, options);
}

/** The status and plain message when a draft cannot be changed. Null for any other error. */
export function draftEditErrorResponse(error: unknown): { status: number; error: string } | null {
  if (error instanceof DraftTitleError) return { status: 400, error: error.message };
  if (error instanceof DraftEditError) return { status: error.reason === "missing" ? 404 : 409, error: error.message };
  if (error instanceof IssuePublishedError) return { status: 409, error: error.message };
  return null;
}
