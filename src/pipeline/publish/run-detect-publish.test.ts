import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSetting: vi.fn(),
  startRun: vi.fn(),
  finishRun: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/src/pipeline/settings", () => ({ readSetting: mocks.readSetting }));
vi.mock("@/src/pipeline/runs", () => ({
  startRun: mocks.startRun,
  finishRun: mocks.finishRun,
  logEvent: mocks.logEvent,
}));
vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import type { GmailReader } from "@/src/pipeline/publish/gmail-client";
import type { PublishStore } from "@/src/pipeline/publish/detect-publish";
import { readPublishOwner, runDetectPublish } from "@/src/pipeline/publish/run-detect-publish";

const NOW = new Date("2026-11-09T16:00:00.000Z");

function gmail(ids: string[], fail = false): GmailReader {
  return {
    listMessageIds: vi.fn(async () => ids),
    getMessage: vi.fn(async (id: string) => {
      if (fail) throw new Error("Gmail request failed with HTTP 500.");
      return { id, subject: "Promo", sentAt: NOW, html: "<p>promo</p>" };
    }),
  };
}

const store: PublishStore = {
  knownMessageIds: async () => new Set(),
  findIssue: async () => null,
  recordEvent: async () => {},
  publish: async () => "published",
};

describe("readPublishOwner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads publish.owner and defaults to n8n for a missing or unknown value", async () => {
    mocks.readSetting.mockResolvedValueOnce("shadow").mockResolvedValueOnce(null).mockResolvedValueOnce("robots");

    expect(await readPublishOwner()).toBe("shadow");
    expect(await readPublishOwner()).toBe("n8n");
    expect(await readPublishOwner()).toBe("n8n");
    expect(mocks.readSetting).toHaveBeenCalledWith("publish.owner");
  });
});

describe("runDetectPublish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startRun.mockResolvedValue(42n);
  });

  it("does nothing while n8n owns publishing", async () => {
    mocks.readSetting.mockResolvedValueOnce("n8n");
    const reader = gmail(["m1"]);

    await expect(runDetectPublish({ gmail: reader, store, now: () => NOW })).resolves.toEqual({ owner: "n8n" });
    expect(reader.listMessageIds).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("records no run when there is no new mail", async () => {
    mocks.readSetting.mockResolvedValueOnce("shadow");

    const result = await runDetectPublish({ gmail: gmail([]), store, now: () => NOW, env: {} });

    expect(result.summary).toEqual({ listed: 0, skipped: 0, results: [], errors: [] });
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("searches with the seed recipients and logs a run with one event per message", async () => {
    mocks.readSetting.mockResolvedValueOnce("shadow");
    const reader = gmail(["m1"]);

    const result = await runDetectPublish({
      gmail: reader,
      store,
      now: () => NOW,
      env: { PUBLISH_SEED_RECIPIENTS: "a@example.test,b@example.test" },
    });

    expect(reader.listMessageIds).toHaveBeenCalledWith(
      "from:newsletter@airecap.news (to:a@example.test OR to:b@example.test) newer_than:3d",
      20,
    );
    expect(result.runId).toBe("42");
    expect(mocks.startRun).toHaveBeenCalledWith({ job: "detect-publish", trigger: "schedule" }, NOW);
    expect(mocks.logEvent).toHaveBeenCalledWith(42n, {
      level: "info",
      step: "message",
      message: "m1: not_an_issue",
      data: { gmailMessageId: "m1", issueId: null, outcome: "not_an_issue" },
    });
    expect(mocks.finishRun).toHaveBeenCalledWith(
      42n,
      { status: "succeeded", stats: { owner: "shadow", listed: 1, skipped: 0, handled: 1, errors: 0 } },
      NOW,
    );
  });

  it("marks the run failed when a message could not be read", async () => {
    mocks.readSetting.mockResolvedValueOnce("native");

    await runDetectPublish({ gmail: gmail(["m1"], true), store, now: () => NOW, env: {} });

    expect(mocks.logEvent).toHaveBeenCalledWith(42n, {
      level: "error",
      step: "message",
      message: "m1: Gmail request failed with HTTP 500.",
      data: { gmailMessageId: "m1" },
    });
    expect(mocks.finishRun).toHaveBeenCalledWith(
      42n,
      {
        status: "failed",
        stats: { owner: "native", listed: 1, skipped: 0, handled: 0, errors: 1 },
        error: "1 message(s) failed.",
      },
      NOW,
    );
  });
});
