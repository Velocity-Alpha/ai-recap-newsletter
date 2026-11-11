import { outlineStoryIds } from "@/src/pipeline/draft/approved-stories";
import { createDraft, markDraftStartFailed, retryDraft, type CreatedDraft } from "@/src/pipeline/draft/draft-store";
import type { ApprovalOutline, BoardFeedback, ProposedBoard } from "@/src/pipeline/draft/outline";
import { saveOutline } from "@/src/pipeline/draft/outline-store";
import { startDraftJob, type DraftJobTarget, type StartDraftOptions } from "@/src/pipeline/draft/start-draft";
import { applyStoryChanges, type StoryChanges } from "@/src/pipeline/draft/story-changes";
import { readStoredUrls, saveBoardActions } from "@/src/pipeline/feedback/board-action-store";
import { diffBoard } from "@/src/pipeline/feedback/board-diff";
import { prisma } from "@/src/server/prisma";
// Only the commit and retry routes import this file. No Netlify function may import it: it pulls in next/server.
import { logServerError } from "@/src/server/observability";

export { DRAFT_START_STEP } from "@/src/pipeline/draft/draft-store";

/**
 * A commit and a retry (#79). The routes call these; the draft-issue background function does the drafting.
 */

export type DraftStart = { started: true } | { started: false; error: string };

export interface NativeCommit {
  outlineId: bigint;
  outlineHash: string;
  storyChanges: StoryChanges;
  draft: CreatedDraft;
  start: DraftStart;
}

function startError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Starting the draft job") ? message : `Could not start the draft job: ${message}`;
}

/** Starts the draft's background function. If that fails, the draft is marked failed, so the board shows "Retry". */
export async function startDraftOrMarkFailed(
  draftId: number,
  target: DraftJobTarget,
  options: StartDraftOptions = {},
): Promise<DraftStart> {
  const now = options.now ?? (() => new Date());
  let error: string;
  try {
    const result = await startDraftJob(draftId, target, options);
    if (result.status === "started") return { started: true };
    error = `Could not start the draft job. ${result.reason}`;
  } catch (thrown) {
    error = startError(thrown);
  }
  await markDraftStartFailed(draftId, error, now());
  return { started: false, error };
}

export interface CommitOptions extends StartDraftOptions {
  /** The proposed board the board sent (#150). Null or absent: only `link` board actions are saved. */
  proposed?: ProposedBoard | null;
  /** The owner's optional reasons for a lead change or a move. */
  feedback?: BoardFeedback[];
}

/**
 * Saves the board actions (#150). Best-effort: a failure is logged and never fails the commit. `storedUrls` is
 * the error when the links could not be read before the story changes.
 */
async function recordBoardActions(
  outlineId: bigint,
  outline: ApprovalOutline,
  storedUrls: Map<number, string | null> | Error,
  options: CommitOptions,
): Promise<void> {
  try {
    if (storedUrls instanceof Error) throw storedUrls;
    const rows = diffBoard({ proposed: options.proposed ?? null, outline, storedUrls, feedback: options.feedback ?? [] });
    await saveBoardActions(prisma, outlineId, outline.date, rows);
  } catch (error) {
    logServerError("draft.commit.board_actions_failed", error, { outlineId: outlineId.toString(), date: outline.date });
  }
}

/**
 * Saves the outline and the proposed board, applies the story changes, saves the board actions, adds the date's
 * next draft, and starts its job, in that order. The stored links are read before the story changes overwrite
 * them. Throws `IssuePublishedError` when the date's issue is published.
 */
export async function commitNativeDraft(
  outline: ApprovalOutline,
  target: DraftJobTarget,
  options: CommitOptions = {},
): Promise<NativeCommit> {
  const saved = await saveOutline(outline, options.proposed ?? null);
  const storedUrls = await readStoredUrls(outlineStoryIds(outline)).catch((error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  );
  const storyChanges = await applyStoryChanges(outline, { fetch: options.fetch });
  await recordBoardActions(saved.id, outline, storedUrls, options);
  const draft = await createDraft(saved.id, { now: options.now });
  const start = await startDraftOrMarkFailed(draft.draftId, target, options);
  return { outlineId: saved.id, outlineHash: saved.hash, storyChanges, draft, start };
}

/**
 * Runs a failed (or stuck) draft again from the start. Throws `DraftNotRetryableError` or `IssuePublishedError`.
 */
export async function retryNativeDraft(
  draftId: number,
  target: DraftJobTarget,
  options: StartDraftOptions = {},
): Promise<{ draft: CreatedDraft; start: DraftStart }> {
  const draft = await retryDraft(draftId, { now: options.now });
  const start = await startDraftOrMarkFailed(draft.draftId, target, options);
  return { draft, start };
}
