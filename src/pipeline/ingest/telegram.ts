import type { IngestResult } from "@/src/pipeline/ingest/ingest";

/**
 * The "stories are ready" message to the AI Recap Review Telegram group, sent after every run as n8n did.
 * Fix: n8n always said "successfully extracted", even when sources failed. This names them.
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
