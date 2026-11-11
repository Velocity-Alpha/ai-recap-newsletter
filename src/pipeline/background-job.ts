import { siteUrlForDeploy, type DeployInfo } from "@/src/pipeline/publish/site-refresh";
import { createJobToken, type JobTokenPurpose } from "@/src/server/job-token";

/**
 * Starts a Netlify background function (15 minutes) from a route, for work that takes longer than a route may
 * run. The call carries the job's input in the body and a short-lived job token signed for that input, so nobody
 * else can start a run, or reuse the token for another input.
 */

export type StartJobResult = { status: "started" } | { status: "not_configured"; reason: string };

export interface StartJobOptions {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  fetch?: typeof fetch;
}

/** The Netlify deploy to call, or the site's address (for a route, `new URL(request.url).origin`). */
export type JobTarget = DeployInfo | { siteUrl: string } | undefined;

export interface BackgroundJob {
  /** The function's path, such as `/.netlify/functions/draft-issue-background`. */
  path: string;
  purpose: JobTokenPurpose;
  /** What the token is signed for: the job's input as text. */
  subject: string;
  body: unknown;
  /** For error messages: "draft" gives "Starting the draft job failed". */
  name: string;
}

function siteUrlOf(target: JobTarget): string {
  if (!target) return "";
  if ("siteUrl" in target) return target.siteUrl;
  return target.site && target.deploy ? siteUrlForDeploy(target) : "";
}

function describeFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  return cause ? `${message} (${cause})` : message;
}

export async function startBackgroundJob(job: BackgroundJob, target: JobTarget, options: StartJobOptions = {}): Promise<StartJobResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) return { status: "not_configured", reason: "Missing setting: SESSION_SECRET." };
  const siteUrl = siteUrlOf(target);
  if (!siteUrl) return { status: "not_configured", reason: "Missing the site address." };

  const send = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await send(`${siteUrl.replace(/\/+$/, "")}${job.path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${createJobToken(job.purpose, secret, now(), job.subject)}`, "content-type": "application/json" },
      body: JSON.stringify(job.body),
      // A redirect would resend this as a GET, which Netlify answers 202 and the function then ignores.
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(`Starting the ${job.name} job failed: ${describeFetchError(error)}.`);
  }
  if (!response.ok) throw new Error(`Starting the ${job.name} job failed with HTTP ${response.status}.`);
  return { status: "started" };
}
