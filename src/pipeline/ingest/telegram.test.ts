import { describe, expect, it, vi } from "vitest";

import type { IngestResult } from "@/src/pipeline/ingest/ingest";
import { buildReadyMessage, createTelegramSender, REVIEW_CHAT_ID } from "@/src/pipeline/ingest/telegram";

function result(overrides: Partial<IngestResult> = {}): IngestResult {
  return {
    targetDate: "2026-11-09",
    storiesSaved: 41,
    sources: [
      { source: "rundown_ai", name: "The Rundown", status: "ok", items: 2, stories: 9, skippedNoLink: 0, errors: [] },
      { source: "tldr", name: "TLDR", status: "no_new", items: 0, stories: 0, skippedNoLink: 0, errors: [] },
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
          { source: "the_signal", name: "The Signal", status: "failed", items: 1, stories: 0, skippedNoLink: 0, errors: ["x"] },
          { source: "tldr", name: "TLDR", status: "partial", items: 2, stories: 3, skippedNoLink: 0, errors: ["y"] },
          { source: "huggingface", name: "Hugging Face", status: "ok", items: 1, stories: 0, skippedNoLink: 0, errors: [] },
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
