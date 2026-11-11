import { createDraft, markDraftStartFailed, retryDraft, type CreatedDraft } from "@/src/pipeline/draft/draft-store";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import { saveOutline } from "@/src/pipeline/draft/outline-store";
import { startDraftJob, type DraftJobTarget, type StartDraftOptions } from "@/src/pipeline/draft/start-draft";
import { applyStoryChanges, type StoryChanges } from "@/src/pipeline/draft/story-changes";

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

/**
 * Saves the outline, applies the story changes, adds the date's next draft, and starts its job, in that order.
 * Throws `IssuePublishedError` when the date's issue is published.
 */
export async function commitNativeDraft(
  outline: ApprovalOutline,
  target: DraftJobTarget,
  options: StartDraftOptions = {},
): Promise<NativeCommit> {
  const saved = await saveOutline(outline);
  const storyChanges = await applyStoryChanges(outline, { fetch: options.fetch });
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
