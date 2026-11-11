import type { Prisma } from "@/src/generated/prisma";
import type { IngestResult } from "@/src/pipeline/ingest/ingest";
import { createSideEffects } from "@/src/pipeline/side-effects";

/**
 * Messages to the AI Recap Review Telegram group: "stories are ready" after every ingest run, as n8n did, and
 * "draft is ready" from the draft job (#149).
 * Fix: n8n always said "successfully extracted", even when sources failed. The stories message names them.
 */

/** The "AI Recap Review" group (docs/n8n-backend/10-ingestion.md §1.6). */
export const REVIEW_CHAT_ID = "-5261405581";
const SITE_URL = "https://airecap.news";

export function buildReadyMessage(result: IngestResult): string {
  const failed = result.sources.filter((source) => source.status === "failed" || source.status === "partial");
  const lines = [
    "Hi there",
    "",
    `Today's stories are in: ${result.storiesSaved} new.`,
    "",
    `Approve stories and publish at ${SITE_URL}/approval?date=${result.targetDate}`,
  ];
  if (failed.length > 0) {
    lines.push("", `These sources had errors: ${failed.map((source) => source.name).join(", ")}. The run log has the details.`);
  }
  lines.push("", "Thank you.");
  return lines.join("\n");
}

export type ReviewGroupStatus = "sent" | "recorded" | "failed" | "not_configured";

export interface ReviewGroupOptions {
  /** `APP_ENV`, `TELEGRAM_REVIEW_BOT_TOKEN`, and `TELEGRAM_REVIEW_CHAT_ID`. */
  env: Record<string, string | undefined>;
  /** Writes to the caller's run log. */
  log: (event: { level: "info" | "warn"; step: "telegram"; message: string; data?: Prisma.InputJsonValue }) => Promise<unknown>;
  /** Replaces the real sender (tests). */
  send?: (text: string) => Promise<void>;
}

/**
 * One message to the review group, through side-effects: sent only in production, recorded in the run log
 * elsewhere. It never throws: a missing token or a failed send is a warning in the run log, and the job goes on.
 */
export async function sendToReviewGroup(text: string, options: ReviewGroupOptions): Promise<ReviewGroupStatus> {
  const { env, log } = options;
  const effects = createSideEffects({
    appEnv: env.APP_ENV,
    record: (entry) =>
      log({
        level: "info",
        step: "telegram",
        message: "Not sent outside production. Recorded the text.",
        data: entry.payload as Prisma.InputJsonValue,
      }).then(() => undefined),
  });
  const token = env.TELEGRAM_REVIEW_BOT_TOKEN?.trim();
  const send = options.send ?? (token ? createTelegramSender({ token, chatId: env.TELEGRAM_REVIEW_CHAT_ID?.trim() || undefined }) : undefined);
  try {
    if (effects.live && !send) {
      await log({ level: "warn", step: "telegram", message: "Missing setting: TELEGRAM_REVIEW_BOT_TOKEN. Not sent." });
      return "not_configured";
    }
    const outcome = await effects.run({
      target: "review_group",
      action: "sendMessage",
      payload: { text },
      send: () => send!(text),
      dryRun: () => undefined,
    });
    if (outcome.mode === "recorded") return "recorded";
    // The message is out: a run log that fails now must not turn it into "failed".
    await log({ level: "info", step: "telegram", message: "Sent the ready message." }).catch(() => undefined);
    return "sent";
  } catch (error) {
    // The run log itself can be what failed, so this warning is best effort.
    await log({ level: "warn", step: "telegram", message: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    return "failed";
  }
}

export function createTelegramSender(options: { token: string; chatId?: string; fetch?: typeof fetch }) {
  const send = options.fetch ?? fetch;
  return async (text: string): Promise<void> => {
    const response = await send(`https://api.telegram.org/bot${options.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: options.chatId ?? REVIEW_CHAT_ID, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { description?: string };
      const reason = typeof body.description === "string" ? ` (${body.description})` : "";
      throw new Error(`Telegram sendMessage failed with HTTP ${response.status}${reason}.`);
    }
  };
}
