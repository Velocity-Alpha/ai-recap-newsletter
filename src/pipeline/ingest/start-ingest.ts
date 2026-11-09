import { isIngestTime } from "@/src/pipeline/ingest/schedule";
import { siteUrlForDeploy, type DeployInfo } from "@/src/pipeline/publish/site-refresh";
import { bearerToken, createJobToken, isValidJobToken } from "@/src/server/job-token";

/**
 * Ingestion can take several minutes, more than a scheduled function's 30 seconds. So the scheduled
 * function only starts the background function (15 minutes), which does the work. The call carries a
 * short-lived job token, so nobody else can start a run.
 */

export const INGEST_BACKGROUND_PATH = "/.netlify/functions/ingest-stories-background";

export type StartIngestResult = { status: "started" } | { status: "not_time" } | { status: "not_configured"; reason: string };

export interface StartIngestOptions {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  fetch?: typeof fetch;
}

export async function startIngestJob(
  context: DeployInfo | undefined,
  options: StartIngestOptions = {},
): Promise<StartIngestResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  // Only production has a schedule, which fires at two UTC times; only the 09:55 New York one goes ahead.
  // Previews run only with "Run now", so they run at any time.
  if (env.APP_ENV === "production" && !isIngestTime(now())) return { status: "not_time" };

  const secret = env.SESSION_SECRET?.trim();
  if (!secret) return { status: "not_configured", reason: "Missing setting: SESSION_SECRET." };
  const siteUrl = context?.site && context.deploy ? siteUrlForDeploy(context) : "";
  if (!siteUrl) return { status: "not_configured", reason: "Missing the site address." };

  const send = options.fetch ?? fetch;
  const response = await send(`${siteUrl.replace(/\/+$/, "")}${INGEST_BACKGROUND_PATH}`, {
    method: "POST",
    headers: { authorization: `Bearer ${createJobToken("ingest-stories", secret, now())}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Starting the ingest job failed with HTTP ${response.status}.`);
  return { status: "started" };
}

export function isAuthorizedIngestRequest(request: Request, env: Record<string, string | undefined>, now: Date): boolean {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret || request.method !== "POST") return false;
  return isValidJobToken("ingest-stories", bearerToken(request), secret, now);
}

export function describeStartIngest(result: StartIngestResult): string {
  switch (result.status) {
    case "started":
      return "Started the ingest background function.";
    case "not_time":
      return "Not 09:55 New York on a weekday. Nothing to do.";
    case "not_configured":
      return `${result.reason} Nothing to do.`;
  }
}
