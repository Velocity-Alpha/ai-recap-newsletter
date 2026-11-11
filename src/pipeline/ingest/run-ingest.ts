import type { Prisma } from "@/src/generated/prisma";
import { createOpenAIExtractor } from "@/src/pipeline/ingest/extract";
import { ingestStories, type IngestResult, type SourceResult } from "@/src/pipeline/ingest/ingest";
import { createPrismaIngestStore } from "@/src/pipeline/ingest/ingest-store";
import { buildReadyMessage, sendToReviewGroup, type ReviewGroupStatus } from "@/src/pipeline/review-group";
import { createGmailReader, readGmailCredentials } from "@/src/pipeline/publish/gmail-client";
import { finishRun, logEvent, startRun, type EventLevel, type RunTrigger } from "@/src/pipeline/runs";
import { shiftDay } from "@/src/pipeline/repeats/match-stories";
import { createRepeatCheck, type RepeatCheckResult } from "@/src/pipeline/repeats/repeat-check";
import { findUnmatchedStoryIds } from "@/src/pipeline/repeats/repeats-store";
import { readSetting } from "@/src/pipeline/settings";

/**
 * Story ingestion with its run log and Telegram message, independent of the job runner. The
 * Netlify background function calls it (netlify/functions/ingest-stories-background.mts).
 */

/** Which job runner acts. Missing means `netlify`. */
type PipelineRunner = "netlify" | "trigger";

const JOB = "ingest-stories";

export type RunIngestResult =
  | { status: "other_runner"; runner: PipelineRunner }
  | { status: "not_configured"; reason: string }
  | { status: "ran"; runId: string; result: IngestResult; telegram: ReviewGroupStatus };

export interface RunIngestOptions {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  trigger?: RunTrigger;
  /** Replaces the real ingestion (tests). */
  ingest?: (now: Date) => Promise<IngestResult>;
  sendTelegram?: (text: string) => Promise<void>;
  /** Replaces the repeat check of the stories with `day` on or after `since` (tests). */
  checkRepeats?: (since: string) => Promise<RepeatCheckResult>;
}

/** The repeat check looks at unchecked stories of the target day and the 3 days before it. */
const REPEAT_CHECK_DAYS_BACK = 3;

function defaultCheckRepeats(apiKey: string) {
  const check = createRepeatCheck({ apiKey });
  return async (since: string) => check(await findUnmatchedStoryIds(since));
}

/** Never fails the run: a story left unchecked is tried again by the next run. */
async function runRepeatCheck(
  runId: bigint,
  targetDate: string,
  check: (since: string) => Promise<RepeatCheckResult>,
): Promise<RepeatCheckResult | { error: string }> {
  try {
    const counts = await check(shiftDay(targetDate, -REPEAT_CHECK_DAYS_BACK));
    const failed = counts.failed ? ` ${counts.failed.count} request(s) failed and will be tried again: ${counts.failed.firstError}` : "";
    await logEvent(runId, {
      level: counts.failed ? "warn" : "info",
      step: "repeats",
      message: `Checked ${counts.checked} stories: ${counts.pairs} pairs judged, ${counts.refused} refused.${failed}`,
      data: counts as unknown as Prisma.InputJsonValue,
    });
    return counts;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await logEvent(runId, { level: "error", step: "repeats", message: `Repeat check failed: ${reason}` }).catch(() => undefined);
    return { error: reason };
  }
}

function defaultIngest(env: Record<string, string | undefined>) {
  const gmail = createGmailReader(readGmailCredentials(env));
  const extract = createOpenAIExtractor({ apiKey: env.OPENAI_API_KEY });
  const store = createPrismaIngestStore();
  return (now: Date) => ingestStories({ gmail, fetch, extract, store, now });
}

function sourceEvent(source: SourceResult): { level: EventLevel; message: string } {
  if (source.status === "failed") return { level: "error", message: `${source.name}: failed. ${source.errors.join(" ")}` };
  const counts = `${source.documents} document(s), ${source.stories} stories, ${source.skippedNoLink} without a link.`;
  if (source.status === "partial") {
    return { level: "warn", message: `${source.name}: partial, ${counts} Errors: ${source.errors.join(" ")}` };
  }
  return { level: "info", message: `${source.name}: ${source.status}, ${counts}` };
}


export async function runIngest(runner: PipelineRunner, options: RunIngestOptions = {}): Promise<RunIngestResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());

  const selected: PipelineRunner = (await readSetting("pipeline.runner")) === "trigger" ? "trigger" : "netlify";
  if (selected !== runner) return { status: "other_runner", runner: selected };

  if (!env.OPENAI_API_KEY?.trim()) return { status: "not_configured", reason: "Missing setting: OPENAI_API_KEY." };
  let ingest = options.ingest;
  if (!ingest) {
    try {
      ingest = defaultIngest(env);
    } catch (error) {
      return { status: "not_configured", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const runId = await startRun({ job: JOB, trigger: options.trigger ?? "schedule" }, now());
  let result: IngestResult;
  try {
    result = await ingest(now());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await finishRun(runId, { status: "failed", error: reason }, now());
    throw error;
  }

  for (const source of result.sources) {
    const { level, message } = sourceEvent(source);
    await logEvent(runId, { level, step: "source", message, data: source as unknown as Prisma.InputJsonValue });
  }
  const repeats = await runRepeatCheck(runId, result.targetDate, options.checkRepeats ?? defaultCheckRepeats(env.OPENAI_API_KEY));
  const telegram = await sendToReviewGroup(buildReadyMessage(result), {
    env,
    send: options.sendTelegram,
    log: (event) => logEvent(runId, event),
  });

  const withErrors = result.sources.filter((source) => source.status === "failed" || source.status === "partial");
  const stats = {
    runner,
    targetDate: result.targetDate,
    storiesSaved: result.storiesSaved,
    repeats: repeats as unknown as Prisma.InputJsonValue,
    telegram,
    sources: result.sources.map(({ source, status, documents, stories, skippedNoLink }) => ({ source, status, documents, stories, skippedNoLink })),
  };
  await finishRun(
    runId,
    withErrors.length > 0
      ? { status: "failed", stats, error: `${withErrors.length} source(s) had errors: ${withErrors.map((source) => source.name).join(", ")}.` }
      : { status: "succeeded", stats },
    now(),
  );
  return { status: "ran", runId: runId.toString(), result, telegram };
}

export function describeIngestRun(run: RunIngestResult): string {
  switch (run.status) {
    case "other_runner":
      return `pipeline.runner is ${run.runner}. This runner does nothing.`;
    case "not_configured":
      return `${run.reason} Nothing to do.`;
    case "ran": {
      const failed = run.result.sources.filter((source) => source.status === "failed" || source.status === "partial");
      const errors = failed.length > 0 ? ` Errors: ${failed.map((source) => source.name).join(", ")}.` : "";
      return `Run ${run.runId}: ${run.result.storiesSaved} stories saved.${errors} Telegram: ${run.telegram}.`;
    }
  }
}
