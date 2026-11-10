import { createTelegramSender, REVIEW_CHAT_ID } from "@/src/pipeline/review-group";

/**
 * Where ops alerts go. Telegram today; Slack (#119) can replace it by changing only `opsChannelFromEnv`.
 */
export interface AlertChannel {
  /** Short name for the run log, e.g. "telegram". */
  readonly name: string;
  send(text: string): Promise<void>;
}

export type OpsChannelResult = { ok: true; channel: AlertChannel } | { ok: false; reason: string };

type Env = Record<string, string | undefined>;

const TELEGRAM_MAX_TEXT = 4096;

/**
 * The review bot posting to the "AI Recap Ops" chat. Throws for an empty chat id or any review-group id, so
 * this channel can never reach the review group (the shared sender would default to it).
 */
export function createTelegramOpsChannel(options: {
  token: string;
  chatId: string;
  /** Extra review-group ids to refuse, on top of REVIEW_CHAT_ID. */
  reviewChatIds?: string[];
  fetch?: typeof fetch;
}): AlertChannel {
  const chatId = options.chatId.trim();
  if (!chatId) throw new Error("The ops chat id is empty. Refusing to fall back to another chat.");
  const refused = new Set([REVIEW_CHAT_ID, ...(options.reviewChatIds ?? []).map((id) => id.trim())]);
  if (refused.has(chatId)) throw new Error("The ops chat id is the review group. Ops alerts never go there.");

  const send = createTelegramSender({ token: options.token, chatId, fetch: options.fetch });
  return {
    name: "telegram",
    send: (text) => send(text.length > TELEGRAM_MAX_TEXT ? text.slice(0, TELEGRAM_MAX_TEXT) : text),
  };
}

/** The ops channel from env: `TELEGRAM_REVIEW_BOT_TOKEN` and `TELEGRAM_OPS_CHAT_ID`. No fallback chat. */
export function opsChannelFromEnv(env: Env, fetchImpl?: typeof fetch): OpsChannelResult {
  const token = env.TELEGRAM_REVIEW_BOT_TOKEN?.trim();
  if (!token) return { ok: false, reason: "Missing setting: TELEGRAM_REVIEW_BOT_TOKEN." };
  const chatId = env.TELEGRAM_OPS_CHAT_ID?.trim();
  if (!chatId) return { ok: false, reason: "Missing setting: TELEGRAM_OPS_CHAT_ID." };

  const reviewOverride = env.TELEGRAM_REVIEW_CHAT_ID?.trim();
  try {
    const channel = createTelegramOpsChannel({
      token,
      chatId,
      reviewChatIds: reviewOverride ? [reviewOverride] : [],
      fetch: fetchImpl,
    });
    return { ok: true, channel };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
