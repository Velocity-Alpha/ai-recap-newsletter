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
import { PLACEHOLDER_ISSUE, renderIssueEmail } from "@/src/pipeline/publish/sent-email.fixture";
import {
  describePublishRun,
  readPipelineRunner,
  runDetectPublish,
  runPublishCatchUp,
  runPublishPoll,
  throwIfPublishRunFailed,
} from "@/src/pipeline/publish/run-detect-publish";

// Monday 11:00 New York.
const NOW = new Date("2026-11-09T16:00:00.000Z");
const TWENTY_MINUTES_AGO = Math.floor(NOW.getTime() / 1000) - 20 * 60;

function gmail(ids: string[], fail = false): GmailReader {
  return {
    listMessageIds: vi.fn(async () => ids),
    getMessage: vi.fn(async (id: string) => {
      if (fail) throw new Error("Gmail request failed with HTTP 500.");
      return { id, subject: "Promo", sentAt: NOW, receivedAt: NOW, html: "<p>promo</p>", text: "promo" };
    }),
  };
}

function store(): PublishStore {
  return {
    knownMessageIds: vi.fn(async () => new Set<string>()),
    findIssue: vi.fn(async () => null),
    recordEvent: vi.fn(async () => {}),
    publish: vi.fn(async () => "published" as const),
  };
}

/** The `pipeline.runner` setting. Null means the row is missing. */
function settings(runner: unknown = null) {
  mocks.readSetting.mockResolvedValue(runner);
}

describe("settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads pipeline.runner and defaults to netlify for a missing or unknown value", async () => {
    mocks.readSetting.mockResolvedValueOnce("trigger").mockResolvedValueOnce(null).mockResolvedValueOnce("cron");

    expect(await readPipelineRunner()).toBe("trigger");
    expect(await readPipelineRunner()).toBe("netlify");
    expect(await readPipelineRunner()).toBe("netlify");
    expect(mocks.readSetting).toHaveBeenCalledWith("pipeline.runner");
  });
});

describe("runDetectPublish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startRun.mockResolvedValue(42n);
  });

  it("stops without the database when the Gmail settings are missing", async () => {
    const result = await runDetectPublish("netlify", 20, { env: {}, now: () => NOW });

    expect(result).toEqual({
      status: "not_configured",
      reason: "Missing Gmail settings: GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN.",
    });
    expect(mocks.readSetting).not.toHaveBeenCalled();
  });

  it("checks Gmail first and leaves the database asleep when there is no new mail", async () => {
    const reader = gmail([]);
    const db = store();

    const result = await runDetectPublish("netlify", 20, { gmail: reader, store: db, env: {}, now: () => NOW });

    expect(result).toEqual({ status: "no_mail" });
    expect(reader.listMessageIds).toHaveBeenCalledWith(`from:newsletter@airecap.news after:${TWENTY_MINUTES_AGO}`, 20);
    expect(mocks.readSetting).not.toHaveBeenCalled();
    expect(db.knownMessageIds).not.toHaveBeenCalled();
  });

  it("does nothing more when the other runner is selected", async () => {
    settings("trigger");
    const db = store();

    const result = await runDetectPublish("netlify", 20, { gmail: gmail(["m1"]), store: db, now: () => NOW });

    expect(result).toEqual({ status: "other_runner", runner: "trigger" });
    expect(db.knownMessageIds).not.toHaveBeenCalled();
  });

  it("searches with the seed recipients and logs a run with one event per message", async () => {
    settings();
    const reader = gmail(["m1"]);

    const result = await runDetectPublish("netlify", 20, {
      gmail: reader,
      store: store(),
      now: () => NOW,
      env: { PUBLISH_SEED_RECIPIENTS: "a@example.test,b@example.test" },
    });

    expect(reader.listMessageIds).toHaveBeenCalledWith(
      `from:newsletter@airecap.news (to:a@example.test OR to:b@example.test) after:${TWENTY_MINUTES_AGO}`,
      20,
    );
    expect(result).toMatchObject({ status: "ran", runId: "42" });
    expect(mocks.startRun).toHaveBeenCalledWith({ job: "detect-publish", trigger: "schedule" }, NOW);
    expect(mocks.logEvent).toHaveBeenCalledWith(42n, {
      level: "info",
      step: "message",
      message: "m1: not_an_issue",
      data: { gmailMessageId: "m1", issueId: null, outcome: "not_an_issue" },
    });
    expect(mocks.finishRun).toHaveBeenCalledWith(
      42n,
      {
        status: "succeeded",
        stats: { runner: "netlify", lookbackMinutes: 20, listed: 1, skipped: 0, handled: 1, errors: 0 },
      },
      NOW,
    );
  });

  it("records no run when every listed message was already handled", async () => {
    settings();
    const db = store();
    vi.mocked(db.knownMessageIds).mockResolvedValue(new Set(["m1"]));

    const result = await runDetectPublish("netlify", 20, { gmail: gmail(["m1"]), store: db, now: () => NOW });

    expect(result).toMatchObject({ status: "ran", summary: { listed: 1, skipped: 1, results: [], errors: [] } });
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("marks the run failed when a message could not be read", async () => {
    settings("trigger");

    await runDetectPublish("trigger", 20, { gmail: gmail(["m1"], true), store: store(), now: () => NOW });

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
        stats: { runner: "trigger", lookbackMinutes: 20, listed: 1, skipped: 0, handled: 0, errors: 1 },
        error: "1 message(s) failed.",
      },
      NOW,
    );
  });
});

describe("site refresh after a native publish", () => {
  const ISSUE_HTML = renderIssueEmail(PLACEHOLDER_ISSUE, { received: true });

  /** Two seed copies of one issue email. The first publishes, the second is already published. */
  function issueMail(): GmailReader {
    return {
      listMessageIds: vi.fn(async () => ["second", "first"]),
      getMessage: vi.fn(async (id: string) => ({
        id,
        subject: "Issue",
        sentAt: new Date(NOW.getTime() - (id === "first" ? 2000 : 1000)),
        receivedAt: NOW,
        html: ISSUE_HTML,
        text: "",
      })),
    };
  }

  function draftStore(): PublishStore {
    let publishedAt: Date | null = null;
    return {
      knownMessageIds: vi.fn(async () => new Set<string>()),
      findIssue: vi.fn(async (id: number) => ({ id, publishedAt, contentJson: null })),
      recordEvent: vi.fn(async () => {}),
      publish: vi.fn(async ({ publishedAt: at }) => {
        if (publishedAt) return "already_published" as const;
        publishedAt = at;
        return "published" as const;
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startRun.mockResolvedValue(42n);
  });

  it("logs the warmed pages after the refresh", async () => {
    settings();
    const refreshSite = vi.fn(async () => ({ warmed: ["/", "/archive", "/issue/ai-recap-2026-11-09"], failed: [] }));

    await runDetectPublish("netlify", 20, { gmail: issueMail(), store: draftStore(), now: () => NOW, refreshSite });

    expect(mocks.logEvent).toHaveBeenCalledWith(42n, {
      level: "info",
      step: "site_warm_up",
      message: "Loaded 3 pages for the cache: /, /archive, /issue/ai-recap-2026-11-09.",
    });
  });

  it("logs a warning but does not fail the run when a page fails to warm", async () => {
    settings();
    const refreshSite = vi.fn(async () => ({
      warmed: ["/"],
      failed: [
        { path: "/archive", reason: "HTTP 500" },
        { path: "/issue/ai-recap-2026-11-09", reason: "The operation was aborted due to timeout" },
      ],
    }));

    const result = await runDetectPublish("netlify", 20, {
      gmail: issueMail(),
      store: draftStore(),
      now: () => NOW,
      refreshSite,
    });

    expect(result).toMatchObject({ status: "ran", siteRefresh: "refreshed" });
    expect(mocks.logEvent).toHaveBeenCalledWith(42n, {
      level: "warn",
      step: "site_warm_up",
      message:
        "Could not load /archive (HTTP 500), /issue/ai-recap-2026-11-09 (The operation was aborted due to timeout). " +
        "The first reader of those pages waits for a fresh render.",
    });
    expect(mocks.finishRun).toHaveBeenCalledWith(42n, expect.objectContaining({ status: "succeeded" }), NOW);
    expect(() => throwIfPublishRunFailed(result)).not.toThrow();
  });

  it("refreshes the site once when an issue was published", async () => {
    settings();
    const refreshSite = vi.fn(async () => ({ warmed: [], failed: [] }));

    const result = await runDetectPublish("netlify", 20, {
      gmail: issueMail(),
      store: draftStore(),
      now: () => NOW,
      refreshSite,
    });

    expect(refreshSite).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "ran", siteRefresh: "refreshed" });
    expect(mocks.logEvent).toHaveBeenCalledWith(42n, {
      level: "info",
      step: "site_refresh",
      message: "Refreshed the site lists and issue pages.",
    });
  });

  it("logs a warning but does not fail the run when the refresh fails", async () => {
    settings();
    const refreshSite = vi.fn(async () => {
      throw new Error("Site refresh failed with HTTP 503.");
    });

    const result = await runDetectPublish("netlify", 20, {
      gmail: issueMail(),
      store: draftStore(),
      now: () => NOW,
      refreshSite,
    });

    expect(result).toMatchObject({ status: "ran", siteRefresh: "failed" });
    expect(mocks.logEvent).toHaveBeenCalledWith(42n, {
      level: "warn",
      step: "site_refresh",
      message: "Site refresh failed with HTTP 503. The lists catch up within the hour.",
    });
    expect(mocks.finishRun).toHaveBeenCalledWith(42n, expect.objectContaining({ status: "succeeded" }), NOW);
    expect(() => throwIfPublishRunFailed(result)).not.toThrow();
  });

  it("logs a warning when no refresh is configured", async () => {
    settings();

    const result = await runDetectPublish("netlify", 20, { gmail: issueMail(), store: draftStore(), now: () => NOW });

    expect(result).toMatchObject({ status: "ran", siteRefresh: "not_configured" });
    expect(mocks.logEvent).toHaveBeenCalledWith(42n, {
      level: "warn",
      step: "site_refresh",
      message: "No site refresh is configured. The lists catch up within the hour.",
    });
  });

  it("does not refresh the site when the issue was already published", async () => {
    settings();
    const refreshSite = vi.fn(async () => ({ warmed: [], failed: [] }));
    const db = draftStore();
    vi.mocked(db.findIssue).mockResolvedValue({ id: 268, publishedAt: NOW, contentJson: null });

    const result = await runDetectPublish("netlify", 20, { gmail: issueMail(), store: db, now: () => NOW, refreshSite });

    expect(refreshSite).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("siteRefresh");
  });
});

describe("runPublishPoll and runPublishCatchUp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the poll does nothing outside 09:00–20:59 New York on weekdays", async () => {
    const reader = gmail(["m1"]);
    const saturday = new Date("2026-11-07T17:00:00.000Z");

    expect(await runPublishPoll("netlify", { gmail: reader, now: () => saturday })).toEqual({
      status: "outside_window",
    });
    expect(reader.listMessageIds).not.toHaveBeenCalled();
  });

  it("the poll looks back 20 minutes and the catch-up 3 days", async () => {
    const reader = gmail([]);

    await runPublishPoll("netlify", { gmail: reader, env: {}, now: () => NOW });
    await runPublishCatchUp("netlify", { gmail: reader, env: {}, now: () => NOW });

    const threeDaysAgo = Math.floor(NOW.getTime() / 1000) - 3 * 24 * 60 * 60;
    expect(vi.mocked(reader.listMessageIds).mock.calls.map(([query]) => query)).toEqual([
      `from:newsletter@airecap.news after:${TWENTY_MINUTES_AGO}`,
      `from:newsletter@airecap.news after:${threeDaysAgo}`,
    ]);
  });
});

describe("describePublishRun and throwIfPublishRunFailed", () => {
  const summary = { listed: 2, skipped: 1, results: [], errors: [{ gmailMessageId: "m2", message: "HTTP 500" }] };

  it("describes each result in one log line", () => {
    expect(describePublishRun({ status: "no_mail" })).toBe("No new issue email. The database was not touched.");
    expect(describePublishRun({ status: "other_runner", runner: "trigger" })).toBe(
      "pipeline.runner is trigger. This runner does nothing.",
    );
    expect(describePublishRun({ status: "ran", summary, runId: "7" })).toBe(
      "Listed 2, skipped 1, handled 0, failed 1. Pipeline run 7.",
    );
    expect(describePublishRun({ status: "ran", summary, runId: "7", siteRefresh: "failed" })).toBe(
      "Listed 2, skipped 1, handled 0, failed 1. Site refresh: failed. Pipeline run 7.",
    );
  });

  it("throws only when a message failed, so the runner shows the run as failed", () => {
    expect(() => throwIfPublishRunFailed({ status: "no_mail" })).not.toThrow();
    expect(() => throwIfPublishRunFailed({ status: "ran", summary, runId: "7" })).toThrow(
      "1 message(s) failed. See pipeline run 7.",
    );
  });
});
