import { describe, expect, it, vi } from "vitest";

import { REVIEW_CHAT_ID } from "@/src/pipeline/review-group";
import { createTelegramOpsChannel, opsChannelFromEnv } from "@/src/pipeline/notify/channel";

const OPS_CHAT_ID = "-4000000001";

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
}

function sentBody(fetch: ReturnType<typeof okFetch>) {
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)) as { chat_id: string; text: string } };
}

describe("createTelegramOpsChannel", () => {
  it("posts to the ops chat through the review bot", async () => {
    const fetch = okFetch();
    const channel = createTelegramOpsChannel({ token: "123:abc", chatId: OPS_CHAT_ID, fetch });

    await channel.send("CRITICAL: test");

    expect(channel.name).toBe("telegram");
    const { url, body } = sentBody(fetch);
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(body).toEqual({ chat_id: OPS_CHAT_ID, text: "CRITICAL: test" });
  });

  it("refuses the review group chat id", () => {
    expect(() => createTelegramOpsChannel({ token: "123:abc", chatId: REVIEW_CHAT_ID, fetch: okFetch() })).toThrow(
      "review group",
    );
    expect(() => createTelegramOpsChannel({ token: "123:abc", chatId: ` ${REVIEW_CHAT_ID} `, fetch: okFetch() })).toThrow(
      "review group",
    );
  });

  it("refuses an overridden review group chat id too", () => {
    expect(() =>
      createTelegramOpsChannel({ token: "123:abc", chatId: "-777", reviewChatIds: ["-777"], fetch: okFetch() }),
    ).toThrow("review group");
  });

  it("refuses an empty chat id instead of falling back to a default", () => {
    expect(() => createTelegramOpsChannel({ token: "123:abc", chatId: "  ", fetch: okFetch() })).toThrow("chat id");
  });

  it("trims text to Telegram's 4096-character limit", async () => {
    const fetch = okFetch();
    const channel = createTelegramOpsChannel({ token: "123:abc", chatId: OPS_CHAT_ID, fetch });

    await channel.send("x".repeat(5000));

    expect(sentBody(fetch).body.text).toHaveLength(4096);
  });
});

describe("opsChannelFromEnv", () => {
  const env = { TELEGRAM_REVIEW_BOT_TOKEN: "123:abc", TELEGRAM_OPS_CHAT_ID: OPS_CHAT_ID };

  it("builds the Telegram ops channel from the review bot token and the ops chat id", async () => {
    const fetch = okFetch();
    const result = opsChannelFromEnv(env, fetch);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.channel.send("hello");
    expect(sentBody(fetch).body.chat_id).toBe(OPS_CHAT_ID);
  });

  it("reports not configured when the ops chat id is missing, and never falls back to the review group", () => {
    const fetch = okFetch();
    const result = opsChannelFromEnv({ TELEGRAM_REVIEW_BOT_TOKEN: "123:abc" }, fetch);

    expect(result).toEqual({ ok: false, reason: "Missing setting: TELEGRAM_OPS_CHAT_ID." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports not configured when the bot token is missing", () => {
    expect(opsChannelFromEnv({ TELEGRAM_OPS_CHAT_ID: OPS_CHAT_ID })).toEqual({
      ok: false,
      reason: "Missing setting: TELEGRAM_REVIEW_BOT_TOKEN.",
    });
  });

  it("refuses when the ops chat id is the review group", () => {
    const fetch = okFetch();
    const result = opsChannelFromEnv({ ...env, TELEGRAM_OPS_CHAT_ID: REVIEW_CHAT_ID }, fetch);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("review group");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses when the ops chat id equals TELEGRAM_REVIEW_CHAT_ID", () => {
    const result = opsChannelFromEnv({ ...env, TELEGRAM_OPS_CHAT_ID: "-777", TELEGRAM_REVIEW_CHAT_ID: "-777" });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("review group");
  });
});
