import { describe, expect, it, vi } from "vitest";

import type { IngestResult } from "@/src/pipeline/ingest/ingest";
import { buildReadyMessage, createTelegramSender, REVIEW_CHAT_ID, sendToReviewGroup } from "@/src/pipeline/ingest/telegram";

function result(overrides: Partial<IngestResult> = {}): IngestResult {
  return {
    targetDate: "2026-11-09",
    storiesSaved: 41,
    sources: [
      { source: "rundown_ai", name: "The Rundown", status: "ok", emails: 2, stories: 9, skippedNoLink: 0, errors: [] },
      { source: "tldr", name: "TLDR", status: "no_new", emails: 0, stories: 0, skippedNoLink: 0, errors: [] },
    ],
    ...overrides,
  };
}

describe("buildReadyMessage", () => {
  it("gives the number of new stories and the approval link", () => {
    expect(buildReadyMessage(result())).toBe(
      [
        "Hi there",
        "",
        "Today's stories are in: 41 new.",
        "",
        "Approve stories and publish at https://airecap.news/approval?date=2026-11-09",
        "",
        "Thank you.",
      ].join("\n"),
    );
  });

  it("names the sources that had errors instead of claiming success", () => {
    const message = buildReadyMessage(
      result({
        storiesSaved: 3,
        sources: [
          { source: "the_signal", name: "The Signal", status: "failed", emails: 1, stories: 0, skippedNoLink: 0, errors: ["x"] },
          { source: "tldr", name: "TLDR", status: "partial", emails: 2, stories: 3, skippedNoLink: 0, errors: ["y"] },
          { source: "huggingface", name: "Hugging Face", status: "ok", emails: 1, stories: 0, skippedNoLink: 0, errors: [] },
        ],
      }),
    );
    expect(message).toContain("Today's stories are in: 3 new.");
    expect(message).toContain("These sources had errors: The Signal, TLDR. The run log has the details.");
  });
});

describe("createTelegramSender", () => {
  it("posts the text to the review group through the Bot API", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const send = createTelegramSender({ token: "123:abc", fetch });

    await send("Hello");

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: REVIEW_CHAT_ID, text: "Hello" });
  });

  it("reports a failure without the token", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }));
    const send = createTelegramSender({ token: "123:abc", fetch });
    const failure = send("Hello");
    await expect(failure).rejects.toThrow("Telegram sendMessage failed with HTTP 401 (Unauthorized).");
    await expect(failure).rejects.not.toThrow("123:abc");
  });
});

describe("sendToReviewGroup", () => {
  type Logged = { level: string; step: string; message: string; data?: unknown };

  function runLog() {
    const events: Logged[] = [];
    return { events, log: async (event: Logged) => void events.push(event) };
  }

  it("sends the text in production and logs that it was sent", async () => {
    const send = vi.fn(async () => undefined);
    const { events, log } = runLog();

    const status = await sendToReviewGroup("Hello", { env: { APP_ENV: "production" }, send, log });

    expect(status).toBe("sent");
    expect(send).toHaveBeenCalledWith("Hello");
    expect(events).toEqual([{ level: "info", step: "telegram", message: "Sent the ready message." }]);
  });

  it.each(["preview", "development", undefined])("records the text and sends nothing when APP_ENV is %j", async (appEnv) => {
    const send = vi.fn();
    const { events, log } = runLog();

    const status = await sendToReviewGroup("Hello", { env: { APP_ENV: appEnv, TELEGRAM_REVIEW_BOT_TOKEN: "123:abc" }, send, log });

    expect(status).toBe("recorded");
    expect(send).not.toHaveBeenCalled();
    expect(events).toEqual([{ level: "info", step: "telegram", message: "Not sent outside production. Recorded the text.", data: { text: "Hello" } }]);
  });

  it("warns and sends nothing in production without the bot token", async () => {
    const { events, log } = runLog();

    const status = await sendToReviewGroup("Hello", { env: { APP_ENV: "production" }, log });

    expect(status).toBe("not_configured");
    expect(events).toEqual([{ level: "warn", step: "telegram", message: "Missing setting: TELEGRAM_REVIEW_BOT_TOKEN. Not sent." }]);
  });

  it("turns a failed send into a warning and does not throw", async () => {
    const send = vi.fn(async () => {
      throw new Error("Telegram sendMessage failed with HTTP 401 (Unauthorized).");
    });
    const { events, log } = runLog();

    const status = await sendToReviewGroup("Hello", { env: { APP_ENV: "production" }, send, log });

    expect(status).toBe("failed");
    expect(events).toEqual([{ level: "warn", step: "telegram", message: "Telegram sendMessage failed with HTTP 401 (Unauthorized)." }]);
  });

  it("does not throw when the run log itself fails", async () => {
    const log = vi.fn(async () => {
      throw new Error("The run log is down.");
    });

    const status = await sendToReviewGroup("Hello", { env: { APP_ENV: "development" }, log });

    expect(status).toBe("failed");
  });

  it("still says sent when the message went out and only the run log failed", async () => {
    const send = vi.fn(async () => undefined);
    const log = vi.fn(async () => {
      throw new Error("The run log is down.");
    });

    const status = await sendToReviewGroup("Hello", { env: { APP_ENV: "production" }, send, log });

    expect(status).toBe("sent");
    expect(send).toHaveBeenCalledWith("Hello");
  });
});
