import { startBackgroundJob, type JobTarget, type StartJobOptions, type StartJobResult } from "@/src/pipeline/background-job";
import { MAX_STORY_IDS } from "@/src/pipeline/free-links/sites";
import { bearerToken, isValidJobToken } from "@/src/server/job-token";

/**
 * The search for free links (#59) can take minutes: a web search and article reads for each story. So the board's
 * route only starts the background function (15 minutes), which runs it. The call carries the story ids in the
 * body and a short-lived `find-free-links` job token signed for those ids.
 */

export const FREE_LINKS_BACKGROUND_PATH = "/.netlify/functions/find-free-links-background";

/** The story ids of a request: whole positive numbers, each once, at most MAX_STORY_IDS. Null for anything else. */
export function readStoryIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_STORY_IDS) return null;
  if (!value.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) return null;
  return [...new Set(value as number[])];
}

function subjectOf(storyIds: number[]): string {
  return storyIds.join(",");
}

export async function startFreeLinksJob(storyIds: number[], target: JobTarget, options: StartJobOptions = {}): Promise<StartJobResult> {
  return startBackgroundJob(
    { path: FREE_LINKS_BACKGROUND_PATH, purpose: "find-free-links", subject: subjectOf(storyIds), body: { storyIds }, name: "free links" },
    target,
    options,
  );
}

/** The story ids from a POST with a valid `find-free-links` job token signed for those ids, else null. */
export async function readFreeLinksJobRequest(request: Request, env: Record<string, string | undefined>, now: Date): Promise<number[] | null> {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret || request.method !== "POST") return null;

  const body = (await request.json().catch(() => null)) as { storyIds?: unknown } | null;
  const storyIds = readStoryIds(body?.storyIds);
  if (!storyIds || storyIds.length === 0) return null;
  return isValidJobToken("find-free-links", bearerToken(request), secret, now, subjectOf(storyIds)) ? storyIds : null;
}
