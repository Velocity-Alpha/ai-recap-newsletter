import type { Prisma } from "@/src/generated/prisma";
import { detectPublish, buildPublishQuery, type DetectPublishSummary, type PublishStore } from "@/src/pipeline/publish/detect-publish";
import { createGmailReader, readGmailCredentials, type GmailReader } from "@/src/pipeline/publish/gmail-client";
import {
  CATCH_UP_LOOKBACK_MINUTES,
  isPublishPollTime,
  POLL_LOOKBACK_MINUTES,
} from "@/src/pipeline/publish/publish-schedule";
import { createPrismaPublishStore } from "@/src/pipeline/publish/publish-store";
import { describeWarmUp, type WarmUpReport } from "@/src/pipeline/publish/site-refresh";
import { finishRun, logEvent, startRun } from "@/src/pipeline/runs";
import { readSetting } from "@/src/pipeline/settings";

/**
 * Publish detection, independent of the job runner. Netlify and Trigger.dev each call it through a thin
 * adapter (`netlify/functions/`, `src/trigger/`).
 *
 * Gmail first (plan §3.2): a run reads Gmail and opens the database only when an issue email arrived in the
 * lookback window, so the polls keep Neon asleep on most runs.
 */

/** Which job runner acts. The other one stops after its Gmail check. Missing means `netlify`. */
export const PIPELINE_RUNNER_KEY = "pipeline.runner";
export type PipelineRunner = "netlify" | "trigger";

const JOB = "detect-publish";
// A send is 2 seed copies. 20 covers several days of sends plus unrelated mail.
const MESSAGE_LIMIT = 20;

export async function readPipelineRunner(): Promise<PipelineRunner> {
  return (await readSetting(PIPELINE_RUNNER_KEY)) === "trigger" ? "trigger" : "netlify";
}

/** Whether the site's cached lists were refreshed after a publish. */
export type SiteRefreshStatus = "refreshed" | "failed" | "not_configured";

export type RunDetectPublishResult =
  | { status: "outside_window" }
  | { status: "not_configured"; reason: string }
  | { status: "no_mail" }
  | { status: "other_runner"; runner: PipelineRunner }
  | {
      status: "ran";
      summary: DetectPublishSummary;
      /** Set when the run was recorded in `pipeline_runs` (only when there was new mail or an error). */
      runId?: string;
      /** Set when an issue was published. */
      siteRefresh?: SiteRefreshStatus;
    };

export interface RunDetectPublishOptions {
  gmail?: GmailReader;
  store?: PublishStore;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /**
   * Asks the site to refresh its cached lists, then loads its main pages so the CDN caches them. The runner
   * adapter builds it (see site-refresh).
   */
  refreshSite?: () => Promise<WarmUpReport>;
}

export async function runDetectPublish(
  runner: PipelineRunner,
  lookbackMinutes: number,
  options: RunDetectPublishOptions = {},
): Promise<RunDetectPublishResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());

  let gmail = options.gmail;
  if (!gmail) {
    try {
      gmail = createGmailReader(readGmailCredentials(env));
    } catch (error) {
      return { status: "not_configured", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const since = new Date(now().getTime() - lookbackMinutes * 60_000);
  const query = buildPublishQuery({ recipients: env.PUBLISH_SEED_RECIPIENTS?.split(","), since });
  const messageIds = await gmail.listMessageIds(query, MESSAGE_LIMIT);
  if (messageIds.length === 0) return { status: "no_mail" };

  // From here on the database is awake anyway.
  const selected = await readPipelineRunner();
  if (selected !== runner) return { status: "other_runner", runner: selected };

  const store = options.store ?? createPrismaPublishStore();
  const summary = await detectPublish({ gmail, store }, { messageIds });
  // Most polls see mail they already handled. Record a run only when something happened.
  if (summary.results.length === 0 && summary.errors.length === 0) return { status: "ran", summary };

  const runId = await startRun({ job: JOB, trigger: "schedule" }, now());
  for (const result of summary.results) {
    await logEvent(runId, {
      level: result.outcome === "needs_review" || result.outcome === "unknown_issue" ? "warn" : "info",
      step: "message",
      message: `${result.gmailMessageId}: ${result.outcome}`,
      data: result as unknown as Prisma.InputJsonValue,
    });
  }
  for (const error of summary.errors) {
    await logEvent(runId, {
      level: "error",
      step: "message",
      message: `${error.gmailMessageId}: ${error.message}`,
      data: { gmailMessageId: error.gmailMessageId },
    });
  }
  const published = summary.results.some((result) => result.outcome === "published");
  const siteRefresh = published ? await refreshSiteAfterPublish(runId, options.refreshSite) : undefined;

  const stats = {
    runner,
    lookbackMinutes,
    listed: summary.listed,
    skipped: summary.skipped,
    handled: summary.results.length,
    errors: summary.errors.length,
  };
  await finishRun(
    runId,
    summary.errors.length > 0
      ? { status: "failed", stats, error: `${summary.errors.length} message(s) failed.` }
      : { status: "succeeded", stats },
    now(),
  );
  return { status: "ran", summary, runId: runId.toString(), ...(siteRefresh && { siteRefresh }) };
}

/** A failed refresh only delays the lists by up to an hour, so it is a warning, not a failed run. */
async function refreshSiteAfterPublish(
  runId: bigint,
  refreshSite: RunDetectPublishOptions["refreshSite"],
): Promise<SiteRefreshStatus> {
  if (!refreshSite) {
    await logEvent(runId, {
      level: "warn",
      step: "site_refresh",
      message: "No site refresh is configured. The lists catch up within the hour.",
    });
    return "not_configured";
  }
  try {
    const warmUp = await refreshSite();
    await logEvent(runId, { level: "info", step: "site_refresh", message: "Refreshed the site lists and issue pages." });
    await logWarmUp(runId, warmUp);
    return "refreshed";
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await logEvent(runId, {
      level: "warn",
      step: "site_refresh",
      message: `${reason} The lists catch up within the hour.`,
    });
    return "failed";
  }
}

/** A page that failed to warm still works: its first reader waits for a render. So it is a warning. */
async function logWarmUp(runId: bigint, report: WarmUpReport): Promise<void> {
  if (report.warmed.length === 0 && report.failed.length === 0) return;
  await logEvent(runId, { step: "site_warm_up", ...describeWarmUp(report) });
}

/** The frequent check: every 5 minutes, weekdays 09:00–20:59 New York. Outside that it does nothing. */
export async function runPublishPoll(
  runner: PipelineRunner,
  options: RunDetectPublishOptions = {},
): Promise<RunDetectPublishResult> {
  const now = options.now ?? (() => new Date());
  if (!isPublishPollTime(now())) return { status: "outside_window" };
  return runDetectPublish(runner, POLL_LOOKBACK_MINUTES, { ...options, now });
}

/** Once a day: catches emails the poll missed (runner down, or sent outside the poll hours). */
export function runPublishCatchUp(
  runner: PipelineRunner,
  options: RunDetectPublishOptions = {},
): Promise<RunDetectPublishResult> {
  return runDetectPublish(runner, CATCH_UP_LOOKBACK_MINUTES, options);
}

export function describePublishRun(result: RunDetectPublishResult): string {
  switch (result.status) {
    case "outside_window":
      return "Outside the publish poll hours. Nothing to do.";
    case "not_configured":
      return `${result.reason} Nothing to do.`;
    case "no_mail":
      return "No new issue email. The database was not touched.";
    case "other_runner":
      return `pipeline.runner is ${result.runner}. This runner does nothing.`;
    case "ran": {
      const { listed, skipped, results, errors } = result.summary;
      const refresh = result.siteRefresh ? ` Site refresh: ${result.siteRefresh}.` : "";
      const run = result.runId ? ` Pipeline run ${result.runId}.` : "";
      return `Listed ${listed}, skipped ${skipped}, handled ${results.length}, failed ${errors.length}.${refresh}${run}`;
    }
  }
}

/** Throws when a message failed, so the runner marks the run failed. Handled messages are skipped next time. */
export function throwIfPublishRunFailed(result: RunDetectPublishResult): void {
  if (result.status !== "ran" || result.summary.errors.length === 0) return;
  throw new Error(`${result.summary.errors.length} message(s) failed. See pipeline run ${result.runId}.`);
}
