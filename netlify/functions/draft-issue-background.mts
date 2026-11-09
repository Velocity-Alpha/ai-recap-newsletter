import { describeDraftRun, runDraftJob } from "@/src/pipeline/draft/run-draft";
import { readDraftJobRequest } from "@/src/pipeline/draft/start-draft";

// Native drafting (#76). The "-background" name gives it 15 minutes. Only startDraftJob starts it, with a
// short-lived job token and the draft id. runDraftJob does nothing for a draft that is not waiting to run.
export default async function draftIssueBackground(request: Request): Promise<void> {
  const draftId = await readDraftJobRequest(request, process.env, new Date());
  if (draftId === null) {
    console.warn("[draft-issue-background] Rejected a request without a valid job token and draft id.");
    return;
  }
  // Never throw: Netlify retries a failed background function, and the draft already records the failure.
  try {
    console.log(`[draft-issue-background] ${describeDraftRun(await runDraftJob(draftId))}`);
  } catch (error) {
    console.error(`[draft-issue-background] Draft ${draftId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
