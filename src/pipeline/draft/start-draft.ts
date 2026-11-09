import { siteUrlForDeploy, type DeployInfo } from "@/src/pipeline/publish/site-refresh";
import { bearerToken, createJobToken, isValidJobToken } from "@/src/server/job-token";

/**
 * A draft takes about a minute, more than a route may run. So the commit route (#79) only starts the background
 * function (15 minutes), which runs the draft. The call carries the draft id in the body and a short-lived
 * `draft-issue` job token signed for that id, so nobody else can start a run, or reuse the token for another draft.
 */

export const DRAFT_BACKGROUND_PATH = "/.netlify/functions/draft-issue-background";

export type StartDraftResult = { status: "started" } | { status: "not_configured"; reason: string };

export interface StartDraftOptions {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  fetch?: typeof fetch;
}

/** The Netlify deploy to call, or the site's address (for a route, `new URL(request.url).origin`). */
export type DraftJobTarget = DeployInfo | { siteUrl: string } | undefined;

function siteUrlOf(target: DraftJobTarget): string {
  if (!target) return "";
  if ("siteUrl" in target) return target.siteUrl;
  return target.site && target.deploy ? siteUrlForDeploy(target) : "";
}

export async function startDraftJob(
  draftId: bigint | number | string,
  target: DraftJobTarget,
  options: StartDraftOptions = {},
): Promise<StartDraftResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) return { status: "not_configured", reason: "Missing setting: SESSION_SECRET." };
  const siteUrl = siteUrlOf(target);
  if (!siteUrl) return { status: "not_configured", reason: "Missing the site address." };

  const id = Number(draftId);
  const send = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await send(`${siteUrl.replace(/\/+$/, "")}${DRAFT_BACKGROUND_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${createJobToken("draft-issue", secret, now(), String(id))}`, "content-type": "application/json" },
      body: JSON.stringify({ draftId: id }),
      // A redirect would resend this as a GET, which Netlify answers 202 and the function then ignores.
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(`Starting the draft job failed: ${describeFetchError(error)}.`);
  }
  if (!response.ok) throw new Error(`Starting the draft job failed with HTTP ${response.status}.`);
  return { status: "started" };
}

function describeFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  return cause ? `${message} (${cause})` : message;
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
