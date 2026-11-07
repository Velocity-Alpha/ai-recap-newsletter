import type { Prisma } from "@/src/generated/prisma";
import {
  buildPublishQuery,
  detectPublish,
  type DetectPublishSummary,
  type PublishStore,
} from "@/src/pipeline/publish/detect-publish";
import { createGmailReader, readGmailCredentials, type GmailReader } from "@/src/pipeline/publish/gmail-client";
import { createPrismaPublishStore } from "@/src/pipeline/publish/publish-store";
import { finishRun, logEvent, startRun } from "@/src/pipeline/runs";
import { readSetting } from "@/src/pipeline/settings";

/** Rule R1: one owner for publish detection. `n8n` (the default) means this job does nothing. */
export const PUBLISH_OWNER_KEY = "publish.owner";
export type PublishOwner = "n8n" | "shadow" | "native";

const JOB = "detect-publish";
// A send is 2 seed copies. 20 covers several days of sends plus unrelated mail.
const MESSAGE_LIMIT = 20;

export async function readPublishOwner(): Promise<PublishOwner> {
  const value = await readSetting(PUBLISH_OWNER_KEY);
  return value === "shadow" || value === "native" ? value : "n8n";
}

export interface RunDetectPublishResult {
  owner: PublishOwner;
  summary?: DetectPublishSummary;
  /** Set when the run was recorded in `pipeline_runs` (only when there was new mail or an error). */
  runId?: string;
}

export async function runDetectPublish(
  options: {
    gmail?: GmailReader;
    store?: PublishStore;
    env?: Record<string, string | undefined>;
    now?: () => Date;
  } = {},
): Promise<RunDetectPublishResult> {
  const owner = await readPublishOwner();
  if (owner === "n8n") return { owner };

  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const gmail = options.gmail ?? createGmailReader(readGmailCredentials(env));
  const store = options.store ?? createPrismaPublishStore();
  const query = buildPublishQuery({ recipients: env.PUBLISH_SEED_RECIPIENTS?.split(","), lookbackDays: 3 });

  const summary = await detectPublish({ gmail, store }, { mode: owner, query, limit: MESSAGE_LIMIT });
  // Most polls find nothing new. Record a run only when something happened, to keep pipeline_runs readable.
  if (summary.results.length === 0 && summary.errors.length === 0) return { owner, summary };

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

  const stats = {
    owner,
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
  return { owner, summary, runId: runId.toString() };
}
