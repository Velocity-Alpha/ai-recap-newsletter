import { beforeEach, describe, expect, it, vi } from "vitest";

const runs = vi.hoisted(() => ({
  started: [] as Array<{ job: string; trigger: string }>,
  finished: [] as Array<{ status: string; stats?: Record<string, unknown>; error?: string }>,
  events: [] as Array<{ level: string; step: string; message: string }>,
}));
vi.mock("@/src/pipeline/runs", () => ({
  startRun: vi.fn(async (input: { job: string; trigger: string }) => {
    runs.started.push(input);
    return 9n;
  }),
  finishRun: vi.fn(async (_id: bigint, result: (typeof runs.finished)[number]) => {
    runs.finished.push(result);
  }),
  logEvent: vi.fn(async (_id: bigint, event: (typeof runs.events)[number]) => {
    runs.events.push(event);
  }),
}));

const notify = vi.hoisted(() => ({
  raiseIncident: vi.fn(),
  resolveIncident: vi.fn(),
  resendOpenCriticals: vi.fn(),
  postToOpsChat: vi.fn(),
  listOpenIncidents: vi.fn(),
  listInfoIncidents: vi.fn(),
  opsChannelFromEnv: vi.fn(),
  runLink: (id: bigint) => `https://airecap.news/admin/runs/${id}`,
}));
vi.mock("@/src/pipeline/notify", () => notify);
const alerts = vi.hoisted(() => ({ resolveAlert: vi.fn() }));
vi.mock("@/src/pipeline/alerts", () => alerts);

import { missingRun, monday, normalDay, skippedDate, thinDay } from "@/src/pipeline/checks/day-facts.fixture";
import type { DayFacts } from "@/src/pipeline/checks/day-facts";
import { describeRunChecks, runChecks } from "@/src/pipeline/checks/run-checks";

const PROD = { APP_ENV: "production", HEALTHCHECKS_PING_URL: "https://hc-ping.example/abc" };
// Tuesday 2026-11-10 (EST).
const AT_1005 = new Date("2026-11-10T15:05:00Z");
const AT_1200 = new Date("2026-11-10T17:00:00Z");
const AT_1800 = new Date("2026-11-10T23:00:00Z");

function fakeFetch() {
  return vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async (url) => {
    const target = String(url);
    if (target.startsWith("https://hc-ping.example/")) return new Response("OK");
    if (target === "https://airecap.news/issue/synthetic-model-ships") {
      return new Response("<h1>Synthetic Model Ships &amp; Agents Learn</h1>");
    }
    if (target === "https://airecap.news/") return new Response('<a href="/issue/synthetic-model-ships">');
    throw new Error(`unexpected fetch ${target}`);
  });
}

function options(now: Date, facts: DayFacts, overrides: Record<string, unknown> = {}) {
  const fetch = fakeFetch();
  const readFacts = vi.fn(async () => facts);
  return { fetch, readFacts, options: { env: PROD, now: () => now, fetch: fetch as unknown as typeof globalThis.fetch, readFacts, ...overrides } };
}

const raisedKeys = () => notify.raiseIncident.mock.calls.map(([input]) => input.incidentKey);
const resolvedKeys = () => notify.resolveIncident.mock.calls.map(([key]) => key);

beforeEach(() => {
  vi.clearAllMocks();
  runs.started.length = 0;
  runs.finished.length = 0;
  runs.events.length = 0;
  notify.raiseIncident.mockResolvedValue({ opened: true, alertId: 1n, delivery: "sent" });
  notify.resolveIncident.mockResolvedValue({ resolved: false, delivery: "skipped" });
  notify.resendOpenCriticals.mockResolvedValue([]);
  notify.postToOpsChat.mockResolvedValue("sent");
  notify.listOpenIncidents.mockResolvedValue([]);
  notify.listInfoIncidents.mockResolvedValue([]);
  notify.opsChannelFromEnv.mockReturnValue({ ok: false, reason: "Missing setting: TELEGRAM_OPS_CHAT_ID." });
  alerts.resolveAlert.mockResolvedValue({});
});

const told = (incidentKey: string, severity = "warning", message = "Something failed.") => ({
  incidentKey,
  severity,
  message,
  notifiedAt: AT_1005,
  firstSeen: AT_1005,
});
const untold = (incidentKey: string) => ({ ...told(incidentKey), notifiedAt: null });

describe("runChecks gate", () => {
  it("does nothing in production outside a check time, and never opens the database", async () => {
    for (const now of [new Date("2026-11-10T15:00:00Z"), new Date("2026-11-07T15:05:00Z")]) {
      const { readFacts, options: opts } = options(now, normalDay());
      await expect(runChecks(opts)).resolves.toEqual({ status: "not_time" });
      expect(readFacts).not.toHaveBeenCalled();
    }
    expect(runs.started).toEqual([]);
    expect(notify.listOpenIncidents).not.toHaveBeenCalled();
  });

  it("runs a full 18:00 pass at any time outside production (Run now on a preview), without a heartbeat", async () => {
    const { fetch, options: opts } = options(new Date("2026-11-10T15:00:00Z"), normalDay(), { env: { ...PROD, APP_ENV: "preview" } });

    const result = await runChecks(opts);

    expect(result).toMatchObject({ status: "ran", time: "18:00", heartbeat: "not_production" });
    expect(notify.postToOpsChat).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(PROD.HEALTHCHECKS_PING_URL);
  });
});

describe("runChecks at 10:05", () => {
  it("raises the failures, resolves the passes, and repeats open criticals once", async () => {
    const { readFacts, options: opts } = options(AT_1005, thinDay());

    const result = await runChecks(opts);

    expect(readFacts).toHaveBeenCalledWith("2026-11-10");
    expect(runs.started).toEqual([{ job: "run-checks", trigger: "schedule" }]);
    expect(raisedKeys()).toEqual(["stories-thin:2026-11-10", "source-empty:alphasignal:2026-11-10"]);
    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({ incidentKey: "stories-thin:2026-11-10", severity: "critical", link: "https://airecap.news/admin/runs/9" }),
      expect.objectContaining({ runId: 9n, now: AT_1005 }),
    );
    expect(resolvedKeys()).toContain("ingest-run-missing:2026-11-10");
    expect(resolvedKeys()).toContain("source-empty:tldr:2026-11-10");
    expect(notify.resendOpenCriticals).toHaveBeenCalledTimes(1);
    expect(notify.resendOpenCriticals.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...notify.raiseIncident.mock.invocationCallOrder, ...notify.resolveIncident.mock.invocationCallOrder),
    );
    expect(notify.postToOpsChat).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "ran",
      runId: "9",
      time: "10:05",
      date: "2026-11-10",
      failing: ["stories-thin:2026-11-10", "source-empty:alphasignal:2026-11-10"],
    });
    expect(runs.finished).toEqual([expect.objectContaining({ status: "succeeded" })]);
  });

  it("raises a missing ingest run as critical", async () => {
    const { options: opts } = options(AT_1005, missingRun());
    await runChecks(opts);
    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({ incidentKey: "ingest-run-missing:2026-11-10", severity: "critical" }),
      expect.anything(),
    );
  });

  it("closes check incidents of earlier dates with one combined message, and leaves other incidents alone", async () => {
    notify.listOpenIncidents.mockResolvedValue([
      told("publish-pending:2026-11-09", "warning", "The draft for 2026-11-09 is ready but not published."),
      told("draft-missing:2026-11-06", "critical", "Committed, but no draft is ready for 2026-11-06."),
      untold("source-empty:tldr:2026-11-09"),
      told("ingest-failed:2026-11-09"),
      told("stories-thin:2026-11-10"),
    ]);
    const { options: opts } = options(AT_1005, normalDay());

    await runChecks(opts);

    expect(alerts.resolveAlert.mock.calls.map(([key]) => key)).toEqual([
      "publish-pending:2026-11-09",
      "draft-missing:2026-11-06",
      "source-empty:tldr:2026-11-09",
    ]);
    expect(alerts.resolveAlert).toHaveBeenCalledWith("publish-pending:2026-11-09", AT_1005);
    // No "resolved" message per incident: one message, listing only the incidents the owner was told about.
    expect(resolvedKeys()).not.toContain("publish-pending:2026-11-09");
    expect(notify.postToOpsChat).toHaveBeenCalledTimes(1);
    expect(notify.postToOpsChat.mock.calls[0][0]).toBe(
      [
        "RESOLVED: closed 2 incidents from earlier days. Their day is over, so their checks no longer run.",
        "- WARNING publish-pending:2026-11-09: The draft for 2026-11-09 is ready but not published.",
        "- CRITICAL draft-missing:2026-11-06: Committed, but no draft is ready for 2026-11-06.",
      ].join("\n"),
    );
    expect(runs.finished[0].stats).toMatchObject({
      closed: ["publish-pending:2026-11-09", "draft-missing:2026-11-06", "source-empty:tldr:2026-11-09"],
    });
  });

  it("closes earlier incidents silently when the owner was never told about them", async () => {
    notify.listOpenIncidents.mockResolvedValue([untold("source-empty:tldr:2026-11-09")]);
    const { options: opts } = options(AT_1005, normalDay());

    await runChecks(opts);

    expect(alerts.resolveAlert).toHaveBeenCalledTimes(1);
    expect(notify.postToOpsChat).not.toHaveBeenCalled();
  });

  it("logs why the story checks wait while the ingest run is still running", async () => {
    const running = { id: "41", status: "running", startedAt: new Date("2026-11-10T14:55:00Z") };
    const { options: opts } = options(AT_1005, thinDay({ ingestRun: running }));

    await runChecks(opts);

    expect(raisedKeys()).toEqual([]);
    expect(resolvedKeys()).toEqual(["ingest-run-missing:2026-11-10"]);
    expect(runs.events).toContainEqual(
      expect.objectContaining({ level: "info", step: "check", message: expect.stringContaining("still running at 10:05") }),
    );
  });

  it("logs a fact it could not read as a warning, and still runs the checks", async () => {
    const warning = "Could not read skipped_dates, so 2026-11-10 counts as not skipped: table missing";
    const { options: opts } = options(AT_1005, thinDay({ warnings: [warning] }));

    await runChecks(opts);

    expect(runs.events).toContainEqual({ level: "warn", step: "facts", message: warning });
    expect(raisedKeys()).toContain("stories-thin:2026-11-10");
    expect(runs.finished).toEqual([expect.objectContaining({ status: "succeeded" })]);
  });
});

describe("runChecks on a skipped date", () => {
  it("raises nothing and closes that date's open check incidents with one message", async () => {
    notify.listOpenIncidents.mockResolvedValue([
      told("stories-thin:2026-11-10", "critical", "Only 30 stories today, under half the usual Tuesday."),
      told("commit-missing:2026-11-10", "warning", "No commit for 2026-11-10 yet."),
      told("ingest-failed:2026-11-10"),
    ]);
    const { options: opts } = options(AT_1200, skippedDate());

    const result = await runChecks(opts);

    expect(notify.raiseIncident).not.toHaveBeenCalled();
    expect(notify.resolveIncident).not.toHaveBeenCalled();
    expect(alerts.resolveAlert.mock.calls.map(([key]) => key)).toEqual(["stories-thin:2026-11-10", "commit-missing:2026-11-10"]);
    expect(notify.postToOpsChat).toHaveBeenCalledTimes(1);
    expect(notify.postToOpsChat.mock.calls[0][0]).toBe(
      [
        "RESOLVED: 2026-11-10 is a skipped date (no issue today), so its checks are off. Closed 2 incidents.",
        "- CRITICAL stories-thin:2026-11-10: Only 30 stories today, under half the usual Tuesday.",
        "- WARNING commit-missing:2026-11-10: No commit for 2026-11-10 yet.",
      ].join("\n"),
    );
    expect(result).toMatchObject({ skipped: true, failing: [] });
  });

  it("still sends the 18:00 summary and the heartbeat", async () => {
    const { fetch, options: opts } = options(AT_1800, skippedDate());

    const result = await runChecks(opts);

    expect(notify.postToOpsChat.mock.calls.at(-1)?.[0]).toContain("Skipped date: no issue today");
    expect(fetch).toHaveBeenCalledWith(PROD.HEALTHCHECKS_PING_URL, expect.objectContaining({ method: "POST" }));
    expect(result).toMatchObject({ skipped: true, summary: "sent", heartbeat: "sent" });
  });
});

describe("runChecks at 12:00", () => {
  it("raises no commit as a warning", async () => {
    const { options: opts } = options(AT_1200, normalDay({ queuedStories: 0, committed: false, draftsMade: 0, draftReady: false, issue: null }));
    await runChecks(opts);
    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({ incidentKey: "commit-missing:2026-11-10", severity: "warning" }),
      expect.anything(),
    );
    expect(notify.postToOpsChat).not.toHaveBeenCalled();
  });
});

describe("runChecks at 18:00", () => {
  it("checks the public site, then sends the summary and pings the heartbeat", async () => {
    notify.listOpenIncidents.mockResolvedValue([
      { incidentKey: "source-empty:tldr:2026-11-10", severity: "warning", message: "No stories from TLDR today.", firstSeen: AT_1005 },
    ]);
    notify.listInfoIncidents.mockResolvedValue([]);
    const { fetch, options: opts } = options(AT_1800, normalDay());

    const result = await runChecks(opts);

    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(
      expect.arrayContaining(["https://airecap.news/issue/synthetic-model-ships", "https://airecap.news/", PROD.HEALTHCHECKS_PING_URL]),
    );
    expect(raisedKeys()).toEqual([]);
    expect(resolvedKeys()).toContain("site-check-failed:2026-11-10");
    const summary = notify.postToOpsChat.mock.calls[0][0] as string;
    expect(summary).toContain("Daily summary: Tuesday 2026-11-10");
    expect(summary).toContain("- WARNING source-empty:tldr:2026-11-10: No stories from TLDR today.");
    // Info incidents since the previous weekday's summary.
    expect(notify.listInfoIncidents).toHaveBeenCalledWith(new Date("2026-11-09T23:00:00Z"));
    // The heartbeat goes after the summary.
    expect(fetch.mock.invocationCallOrder.at(-1)).toBeGreaterThan(notify.postToOpsChat.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ summary: "sent", heartbeat: "sent" });
  });

  it("lists Monday's info incidents since Friday 18:00 New York, across the daylight-saving switch", async () => {
    // Monday 2026-11-02 18:00 EST. Friday 2026-10-30 18:00 was still EDT: 22:00 UTC, not 23:00.
    const { options: opts } = options(new Date("2026-11-02T23:00:00Z"), monday({ date: "2026-11-02" }));

    await runChecks(opts);

    expect(notify.listInfoIncidents).toHaveBeenCalledWith(new Date("2026-10-30T22:00:00Z"));
  });

  it("raises a critical when the issue page is missing", async () => {
    const { fetch, options: opts } = options(AT_1800, normalDay());
    fetch.mockImplementation(async (url) =>
      String(url).includes("/issue/") ? new Response("gone", { status: 404 }) : new Response('<a href="/issue/synthetic-model-ships">'),
    );

    await runChecks(opts);

    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({ incidentKey: "site-check-failed:2026-11-10", severity: "critical" }),
      expect.anything(),
    );
  });

  it("pings the fail URL when the summary does not reach the ops chat", async () => {
    notify.postToOpsChat.mockResolvedValue("not_configured");
    const { fetch, options: opts } = options(AT_1800, normalDay());

    await runChecks(opts);

    expect(fetch).toHaveBeenCalledWith(`${PROD.HEALTHCHECKS_PING_URL}/fail`, expect.anything());
  });

  it("records a missing ping URL or a failed ping, and still succeeds", async () => {
    const missing = options(AT_1800, normalDay(), { env: { APP_ENV: "production" } });
    await expect(runChecks(missing.options)).resolves.toMatchObject({ heartbeat: "not_configured" });

    const failing = options(AT_1800, normalDay());
    failing.fetch.mockImplementation(async (url) => {
      if (String(url).startsWith("https://hc-ping.example/")) throw new Error("fetch failed");
      return String(url).includes("/issue/")
        ? new Response("<h1>Synthetic Model Ships &amp; Agents Learn</h1>")
        : new Response('<a href="/issue/synthetic-model-ships">');
    });
    await expect(runChecks(failing.options)).resolves.toMatchObject({ heartbeat: "failed" });

    expect(runs.finished.map((run) => run.status)).toEqual(["succeeded", "succeeded"]);
    expect(runs.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "heartbeat", message: "Not sent: HEALTHCHECKS_PING_URL is not configured." }),
        expect.objectContaining({ step: "heartbeat", message: "Not sent: fetch failed" }),
      ]),
    );
  });
});

describe("runChecks failure", () => {
  it("tells the ops chat, marks the run failed, and rethrows", async () => {
    const { options: opts } = options(AT_1005, normalDay());
    opts.readFacts.mockRejectedValueOnce(new Error("connection refused"));

    await expect(runChecks(opts)).rejects.toThrow("connection refused");
    expect(runs.finished).toEqual([expect.objectContaining({ status: "failed", error: "connection refused" })]);
    expect(notify.postToOpsChat).toHaveBeenCalledTimes(1);
    expect(notify.postToOpsChat).toHaveBeenCalledWith(
      [
        "CRITICAL: run-checks failed. The 10:05 checks for 2026-11-10 stopped.",
        "Error: connection refused",
        "Link: https://airecap.news/admin/runs/9",
      ].join("\n"),
      expect.objectContaining({ runId: 9n, env: PROD }),
    );
  });

  it("still tells the ops chat when the run row cannot be written", async () => {
    const { startRun } = await import("@/src/pipeline/runs");
    vi.mocked(startRun).mockRejectedValueOnce(new Error("database unreachable"));
    const { options: opts } = options(AT_1005, normalDay());

    await expect(runChecks(opts)).rejects.toThrow("database unreachable");
    expect(notify.postToOpsChat.mock.calls[0][0]).toContain("Error: database unreachable");
    expect(notify.postToOpsChat.mock.calls[0][0]).toContain("No run row was written.");
    expect(notify.postToOpsChat.mock.calls[0][1]).not.toHaveProperty("runId");
    expect(runs.finished).toEqual([]);
  });

  it("rethrows the original error when the failure message cannot be posted", async () => {
    notify.postToOpsChat.mockRejectedValueOnce(new Error("logEvent failed"));
    const { options: opts } = options(AT_1005, normalDay());
    opts.readFacts.mockRejectedValueOnce(new Error("connection refused"));

    await expect(runChecks(opts)).rejects.toThrow("connection refused");
  });
});

describe("runChecks time limits", () => {
  it("sends production alerts through an ops channel whose calls share the run's deadline", async () => {
    const channel = { name: "telegram", send: vi.fn() };
    notify.opsChannelFromEnv.mockReturnValue({ ok: true, channel });
    const { options: opts } = options(AT_1005, thinDay());

    await runChecks(opts);

    expect(notify.opsChannelFromEnv).toHaveBeenCalledWith(PROD, expect.any(Function));
    expect(notify.raiseIncident).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ channel }));
    expect(notify.resendOpenCriticals).toHaveBeenCalledWith(expect.objectContaining({ channel }));
  });

  it("lets notify report a missing ops chat, and builds no channel outside production", async () => {
    const { options: opts } = options(AT_1005, thinDay());
    await runChecks(opts);
    expect(notify.raiseIncident.mock.calls[0][1]).not.toHaveProperty("channel");

    vi.clearAllMocks();
    const preview = options(AT_1005, thinDay(), { env: { APP_ENV: "preview" } });
    await runChecks(preview.options);
    expect(notify.opsChannelFromEnv).not.toHaveBeenCalled();
  });

  it("gives each site fetch a signal, and logs when the run passed its budget for outside calls", async () => {
    const { fetch, options: opts } = options(AT_1800, normalDay(), { budgetMs: 1 });
    const answer = fetch.getMockImplementation();
    // A slow site: the 1 ms budget runs out while it answers.
    fetch.mockImplementation(async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return answer!(url);
    });

    await runChecks(opts);

    const siteCall = fetch.mock.calls.find(([url]) => String(url).includes("/issue/"));
    expect((siteCall?.[1] as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
    expect(runs.events).toContainEqual(
      expect.objectContaining({ level: "warn", step: "deadline", message: expect.stringContaining("budget") }),
    );
  });
});

describe("describeRunChecks", () => {
  it("describes each result in one line", () => {
    expect(describeRunChecks({ status: "not_time" })).toBe("Not a check time (10:05, 12:00, 18:00 New York, weekdays). Nothing to do.");
    expect(
      describeRunChecks({
        status: "ran",
        runId: "9",
        time: "18:00",
        date: "2026-11-10",
        skipped: false,
        failing: ["stories-thin:2026-11-10"],
        summary: "sent",
        heartbeat: "sent",
      }),
    ).toBe("Run 9: 18:00 checks for 2026-11-10. Failing: stories-thin:2026-11-10. Summary: sent. Heartbeat: sent.");
  });
});
