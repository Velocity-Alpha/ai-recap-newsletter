import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => new Map<string, unknown>());
const events = vi.hoisted(() => [] as Array<{ level: string; step: string; message: string; data?: unknown }>);
const runs = vi.hoisted(() => [] as Array<{ status: string; stats?: unknown; error?: string }>);

vi.mock("@/src/pipeline/settings", () => ({
  readSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
}));
vi.mock("@/src/pipeline/runs", () => ({
  startRun: vi.fn(async () => BigInt(7)),
  logEvent: vi.fn(async (_runId: bigint, event: (typeof events)[number]) => {
    events.push(event);
  }),
  finishRun: vi.fn(async (_runId: bigint, result: (typeof runs)[number]) => {
    runs.push(result);
  }),
}));

// The tests that do not pass `checkRepeats` find no unchecked story.
vi.mock("@/src/pipeline/repeats/repeats-store", () => ({
  findUnmatchedStoryIds: vi.fn(async () => []),
  readRepeatWindowDays: vi.fn(async () => 14),
  createPrismaRepeatsStore: vi.fn(() => ({})),
}));

import type { IngestResult } from "@/src/pipeline/ingest/ingest";
import { describeIngestRun, runIngest } from "@/src/pipeline/ingest/run-ingest";

const ENV = {
  APP_ENV: "production",
  GMAIL_OAUTH_CLIENT_ID: "a",
  GMAIL_OAUTH_CLIENT_SECRET: "b",
  GMAIL_OAUTH_REFRESH_TOKEN: "c",
  OPENAI_API_KEY: "k",
  TELEGRAM_REVIEW_BOT_TOKEN: "t",
};

function ingestResult(failed = false): IngestResult {
  return {
    targetDate: "2026-11-09",
    storiesSaved: 5,
    sources: [
      { source: "rundown_ai", name: "The Rundown", status: "ok", documents: 1, stories: 5, skippedNoLink: 1, errors: [] },
      ...(failed
        ? [{ source: "tldr", name: "TLDR", status: "failed" as const, documents: 0, stories: 0, skippedNoLink: 0, errors: ["HTTP 500"] }]
        : []),
    ],
  };
}

beforeEach(() => {
  settings.clear();
  events.length = 0;
  runs.length = 0;
});

describe("runIngest", () => {
  it("does nothing when the other runner is selected", async () => {
    settings.set("pipeline.runner", "trigger");
    await expect(runIngest("netlify", { env: ENV, ingest: vi.fn() })).resolves.toEqual({ status: "other_runner", runner: "trigger" });
  });

  it("names missing settings before it starts", async () => {
    const result = await runIngest("netlify", { env: { ...ENV, OPENAI_API_KEY: "" }, ingest: vi.fn() });
    expect(result).toEqual({ status: "not_configured", reason: "Missing setting: OPENAI_API_KEY." });
  });

  it("logs each source, checks repeats, sends the Telegram message in production, and records the run", async () => {
    const sendTelegram = vi.fn(async () => undefined);
    const counts = { checked: 4, embedded: 4, judged: 3, pairs: 9, refused: 1 };
    const checkRepeats = vi.fn(async () => counts);
    const result = await runIngest("netlify", { env: ENV, ingest: vi.fn(async () => ingestResult()), sendTelegram, checkRepeats });

    expect(result).toMatchObject({ status: "ran", runId: "7", telegram: "sent" });
    expect(checkRepeats).toHaveBeenCalledWith("2026-11-06");
    expect(sendTelegram).toHaveBeenCalledWith(expect.stringContaining("Today's stories are in: 5 new."));
    expect(events.map((event) => `${event.level} ${event.step}: ${event.message}`)).toEqual([
      "info source: The Rundown: ok, 1 document(s), 5 stories, 1 without a link.",
      "info repeats: Checked 4 stories: 9 pairs judged, 1 refused.",
      "info telegram: Sent the ready message.",
    ]);
    expect(events[1].data).toEqual(counts);
    expect(runs).toEqual([{ status: "succeeded", stats: expect.objectContaining({ storiesSaved: 5, repeats: counts }) }]);
  });

  it("warns when some judge requests failed", async () => {
    const counts = { checked: 4, embedded: 0, judged: 2, pairs: 5, refused: 0, failed: { count: 1, firstError: "HTTP 500" } };
    await runIngest("netlify", { env: ENV, ingest: vi.fn(async () => ingestResult()), sendTelegram: vi.fn(), checkRepeats: vi.fn(async () => counts) });
    expect(events).toContainEqual(
      expect.objectContaining({
        level: "warn",
        step: "repeats",
        message: "Checked 4 stories: 5 pairs judged, 0 refused. 1 request(s) failed and will be tried again: HTTP 500",
      }),
    );
  });

  it("logs a failed repeat check, and still sends the message and succeeds", async () => {
    const sendTelegram = vi.fn(async () => undefined);
    const checkRepeats = vi.fn(async () => {
      throw new Error("Embeddings: HTTP 500");
    });
    const result = await runIngest("netlify", { env: ENV, ingest: vi.fn(async () => ingestResult()), sendTelegram, checkRepeats });

    expect(result).toMatchObject({ status: "ran", telegram: "sent" });
    expect(events).toContainEqual(expect.objectContaining({ level: "error", step: "repeats", message: "Repeat check failed: Embeddings: HTTP 500" }));
    expect(sendTelegram).toHaveBeenCalled();
    expect(runs).toEqual([{ status: "succeeded", stats: expect.objectContaining({ repeats: { error: "Embeddings: HTTP 500" } }) }]);
  });

  it("records the message instead of sending it outside production", async () => {
    const sendTelegram = vi.fn();
    const result = await runIngest("netlify", {
      env: { ...ENV, APP_ENV: "preview" },
      ingest: vi.fn(async () => ingestResult()),
      sendTelegram,
    });

    expect(result).toMatchObject({ status: "ran", telegram: "recorded" });
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ step: "telegram", message: "Not sent outside production. Recorded the text." });
    expect(events.at(-1)?.data).toEqual({ text: expect.stringContaining("Today's stories are in") });
  });

  it("marks the run failed when a source failed, and a Telegram failure is only a warning", async () => {
    const sendTelegram = vi.fn(async () => {
      throw new Error("Telegram sendMessage failed with HTTP 401 (Unauthorized).");
    });
    const result = await runIngest("netlify", { env: ENV, ingest: vi.fn(async () => ingestResult(true)), sendTelegram });

    expect(result).toMatchObject({ status: "ran", telegram: "failed" });
    expect(events).toContainEqual(expect.objectContaining({ level: "error", step: "source", message: "TLDR: failed. HTTP 500" }));
    expect(events.at(-1)).toMatchObject({ level: "warn", step: "telegram" });
    expect(runs[0]).toMatchObject({ status: "failed", error: "1 source(s) had errors: TLDR." });
  });
});

describe("describeIngestRun", () => {
  it("summarises a run for the function log", () => {
    expect(
      describeIngestRun({ status: "ran", runId: "7", result: ingestResult(true), telegram: "sent" }),
    ).toBe("Run 7: 5 stories saved. Errors: TLDR. Telegram: sent.");
  });
});
