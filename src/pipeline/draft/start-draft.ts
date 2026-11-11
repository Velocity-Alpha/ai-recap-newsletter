import { startBackgroundJob, type JobTarget, type StartJobOptions, type StartJobResult } from "@/src/pipeline/background-job";
import { bearerToken, isValidJobToken } from "@/src/server/job-token";

/**
 * A draft takes about a minute, more than a route may run. So the commit route (#79) only starts the background
 * function (15 minutes), which runs the draft. The call carries the draft id in the body and a short-lived
 * `draft-issue` job token signed for that id, so nobody else can start a run, or reuse the token for another draft.
 */

export const DRAFT_BACKGROUND_PATH = "/.netlify/functions/draft-issue-background";

export type StartDraftResult = StartJobResult;
export type StartDraftOptions = StartJobOptions;
export type DraftJobTarget = JobTarget;

export async function startDraftJob(
  draftId: bigint | number | string,
  target: DraftJobTarget,
  options: StartDraftOptions = {},
): Promise<StartDraftResult> {
  const id = Number(draftId);
  return startBackgroundJob(
    { path: DRAFT_BACKGROUND_PATH, purpose: "draft-issue", subject: String(id), body: { draftId: id }, name: "draft" },
    target,
    options,
  );
}

/** The draft id from a POST with a valid `draft-issue` job token signed for that id, else null. */
export async function readDraftJobRequest(request: Request, env: Record<string, string | undefined>, now: Date): Promise<number | null> {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret || request.method !== "POST") return null;

  const body = (await request.json().catch(() => null)) as { draftId?: unknown } | null;
  const draftId = body?.draftId;
  if (typeof draftId !== "number" || !Number.isSafeInteger(draftId) || draftId <= 0) return null;
  return isValidJobToken("draft-issue", bearerToken(request), secret, now, String(draftId)) ? draftId : null;
}

export function describeStartDraft(result: StartDraftResult): string {
  return result.status === "started" ? "Started the draft background function." : `${result.reason} Nothing to do.`;
}
