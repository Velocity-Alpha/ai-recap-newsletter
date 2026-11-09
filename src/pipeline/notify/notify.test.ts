import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real alerts.ts runs against a small in-memory `alerts` table, so these tests cover de-duplication and
 * severity routing end to end. Telegram is a fake channel; global fetch fails the test if anything reaches it.
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: bigint };
  const rows: Row[] = [];
  let nextId = 1n;

  function matches(row: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (key === "OR") return (condition as Record<string, unknown>[]).some((part) => matches(row, part));
      const value = row[key] as Date | string | bigint | null;
      if (condition === null) return value === null;
      if (typeof condition === "object" && !(condition instanceof Date)) {
        const range = condition as { lt?: Date; gte?: Date };
        if (value === null) return false;
        if (range.lt) return (value as Date) < range.lt;
        if (range.gte) return (value as Date) >= range.gte;
      }
      return value === condition;
    });
  }

  const alert = {
    findUnique: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) return null;
      return select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : { ...row };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (rows.some((row) => row.openIncidentKey === data.openIncidentKey)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row: Row = { notifiedAt: null, resolvedAt: null, context: null, ...data, id: nextId++ };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) throw new Error("Record to update not found");
      Object.assign(row, data);
      return { ...row };
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      rows
        .filter((row) => matches(row, where))
        .sort((a, b) => (a.firstSeen as Date).getTime() - (b.firstSeen as Date).getTime())
        .map((row) => ({ ...row })),
  };

  const events: Array<{ runId: bigint; level: string; step: string; message: string; data?: { text?: string } }> = [];

  return {
    rows,
    events,
    prisma: { alert },
    reset() {
      rows.length = 0;
      events.length = 0;
      nextId = 1n;
    },
  };
});

vi.mock("@/src/server/prisma", () => ({ prisma: fake.prisma }));
vi.mock("@/src/pipeline/runs", () => ({
  logEvent: vi.fn(async (runId: bigint, event: Omit<(typeof fake.events)[number], "runId">) => {
    fake.events.push({ runId, ...event });
  }),
}));

import { REVIEW_CHAT_ID } from "@/src/pipeline/ingest/telegram";
import {
  listInfoIncidents,
  listOpenIncidents,
  postToOpsChat,
  raiseIncident,
  resendOpenCriticals,
  resolveIncident,
  runLink,
  type AlertChannel,
  type IncidentInput,
} from "@/src/pipeline/notify";

const PROD = { APP_ENV: "production" };
const DEV = { APP_ENV: "development" };
const RUN_ID = 42n;

const at = (time: string) => new Date(`2026-11-09T${time}:00.000Z`);

function fakeChannel(): AlertChannel & { send: ReturnType<typeof vi.fn<(text: string) => Promise<void>>> } {
  return { name: "fake", send: vi.fn<(text: string) => Promise<void>>(async () => undefined) };
}

function incident(overrides: Partial<IncidentInput> = {}): IncidentInput {
  return {
    incidentKey: "stories-missing:2026-11-09",
    severity: "critical",
    what: "No ingest run today",
    evidence: "No ingest-stories run since 00:00 New York time.",
    link: runLink(RUN_ID),
    ...overrides,
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fake.reset();
  fetchSpy = vi.fn(async () => {
    throw new Error("Real network call in a unit test.");
  });
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("postToOpsChat: production only", () => {
  it("sends through the channel in production and logs it in the run", async () => {
    const channel = fakeChannel();

    await expect(postToOpsChat("hello", { env: PROD, channel, runId: RUN_ID })).resolves.toBe("sent");

    expect(channel.send).toHaveBeenCalledWith("hello");
    expect(fake.events).toEqual([
      { runId: RUN_ID, level: "info", step: "alert", message: "Sent to the ops chat (fake).", data: { text: "hello" } },
    ]);
  });

  it.each(["development", "preview", undefined])("never sends when APP_ENV is %s; records the text in the run", async (appEnv) => {
    const channel = fakeChannel();

    await expect(postToOpsChat("hello", { env: { APP_ENV: appEnv }, channel, runId: RUN_ID })).resolves.toBe("recorded");

    expect(channel.send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.events).toEqual([
      {
        runId: RUN_ID,
        level: "info",
        step: "alert",
        message: "Not sent outside production. Recorded the text.",
        data: { text: "hello" },
      },
    ]);
  });

  it("writes a structured log when there is no run", async () => {
    const channel = fakeChannel();

    await expect(postToOpsChat("hello", { env: DEV, channel })).resolves.toBe("recorded");

    expect(channel.send).not.toHaveBeenCalled();
    expect(fake.events).toEqual([]);
    const logged = JSON.parse(String(vi.mocked(console.info).mock.calls[0][0]));
    expect(logged).toEqual({ step: "alert", level: "info", message: "Not sent outside production. Recorded the text.", text: "hello" });
  });

  it("reports not configured when the ops chat id is missing, without touching the network", async () => {
    const env = { ...PROD, TELEGRAM_REVIEW_BOT_TOKEN: "123:abc" };

    await expect(postToOpsChat("hello", { env, runId: RUN_ID })).resolves.toBe("not_configured");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.events[0]).toMatchObject({ level: "warn", message: "Missing setting: TELEGRAM_OPS_CHAT_ID. Not sent." });
  });

  it("reports a failed send without throwing", async () => {
    const channel = fakeChannel();
    channel.send.mockRejectedValueOnce(new Error("Telegram sendMessage failed with HTTP 429."));

    await expect(postToOpsChat("hello", { env: PROD, channel, runId: RUN_ID })).resolves.toBe("failed");

    expect(fake.events[0]).toMatchObject({ level: "warn", message: "Not sent: Telegram sendMessage failed with HTTP 429." });
  });
});

describe("the review group", () => {
  it("is never posted to, even when the ops chat id is set to it", async () => {
    const env = { ...PROD, TELEGRAM_REVIEW_BOT_TOKEN: "123:abc", TELEGRAM_OPS_CHAT_ID: REVIEW_CHAT_ID };

    const result = await raiseIncident(incident(), { env, runId: RUN_ID, now: at("15:05") });

    expect(result.delivery).toBe("not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.events[0].message).toContain("review group");
  });
});

describe("raiseIncident: de-duplication", () => {
  it("keeps one open alert per incident key and does not repeat a critical on the next raise", async () => {
    const channel = fakeChannel();

    const first = await raiseIncident(incident(), { env: PROD, channel, now: at("15:05") });
    const second = await raiseIncident(incident({ evidence: "Still no run." }), { env: PROD, channel, now: at("15:20") });

    expect(first).toMatchObject({ opened: true, delivery: "sent" });
    expect(second).toMatchObject({ opened: false, delivery: "skipped", alertId: first.alertId });
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({
      status: "open",
      lastSeen: at("15:20"),
      notifiedAt: at("15:05"),
      context: { evidence: "Still no run.", link: runLink(RUN_ID) },
    });
  });

  it("opens a new incident, and alerts again, once the old one is resolved", async () => {
    const channel = fakeChannel();

    await raiseIncident(incident({ severity: "warning" }), { env: PROD, channel, now: at("15:05") });
    await resolveIncident("stories-missing:2026-11-09", { env: PROD, channel, now: at("16:00") });
    const again = await raiseIncident(incident({ severity: "warning" }), { env: PROD, channel, now: at("17:00") });

    expect(again).toMatchObject({ opened: true, delivery: "sent" });
    expect(fake.rows.map((row) => row.status)).toEqual(["resolved", "open"]);
    expect(channel.send).toHaveBeenCalledTimes(3);
  });
});

describe("raiseIncident: severity routing", () => {
  it("sends a critical at once, naming what failed, the evidence, and the link", async () => {
    const channel = fakeChannel();

    await raiseIncident(incident(), { env: PROD, channel, now: at("15:05") });

    expect(channel.send).toHaveBeenCalledWith(
      [
        "CRITICAL: No ingest run today",
        "Evidence: No ingest-stories run since 00:00 New York time.",
        "Link: https://airecap.news/admin/runs/42",
        "Incident: stories-missing:2026-11-09",
      ].join("\n"),
    );
  });

  it("sends a warning once per incident", async () => {
    const channel = fakeChannel();
    const warning = incident({ incidentKey: "source-empty:tldr:2026-11-09", severity: "warning", what: "TLDR has no stories today" });

    await raiseIncident(warning, { env: PROD, channel, now: at("15:05") });
    await raiseIncident(warning, { env: PROD, channel, now: at("17:00") });
    await raiseIncident(warning, { env: PROD, channel, now: at("23:00") });

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send.mock.calls[0][0]).toMatch(/^WARNING: TLDR has no stories today\n/);
  });

  it("never sends info, even in production", async () => {
    const channel = fakeChannel();

    const result = await raiseIncident(incident({ severity: "info", incidentKey: "slow-run:ingest" }), {
      env: PROD,
      channel,
      now: at("15:05"),
    });

    expect(result).toMatchObject({ opened: true, delivery: "skipped" });
    expect(channel.send).not.toHaveBeenCalled();
    expect(fake.rows[0]).toMatchObject({ severity: "info", notifiedAt: null });
  });

  it("sends at once when a warning escalates to critical", async () => {
    const channel = fakeChannel();

    await raiseIncident(incident({ severity: "warning" }), { env: PROD, channel, now: at("15:05") });
    const escalated = await raiseIncident(incident(), { env: PROD, channel, now: at("17:00") });

    expect(escalated.delivery).toBe("sent");
    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(channel.send.mock.calls[1][0]).toMatch(/^CRITICAL: /);
  });

  it("tries again on the next raise when a send failed", async () => {
    const channel = fakeChannel();
    channel.send.mockRejectedValueOnce(new Error("HTTP 502"));

    const first = await raiseIncident(incident({ severity: "warning" }), { env: PROD, channel, now: at("15:05") });
    const retry = await raiseIncident(incident({ severity: "warning" }), { env: PROD, channel, now: at("16:00") });

    expect([first.delivery, retry.delivery]).toEqual(["failed", "sent"]);
    expect(fake.rows[0].notifiedAt).toEqual(at("16:00"));
  });

  it("outside production records each warning once, like production would send it", async () => {
    const channel = fakeChannel();
    const warning = incident({ severity: "warning" });

    const first = await raiseIncident(warning, { env: DEV, channel, runId: RUN_ID, now: at("15:05") });
    const second = await raiseIncident(warning, { env: DEV, channel, runId: RUN_ID, now: at("17:00") });

    expect([first.delivery, second.delivery]).toEqual(["recorded", "skipped"]);
    expect(channel.send).not.toHaveBeenCalled();
    expect(fake.events.map((event) => event.data?.text?.split("\n")[0])).toEqual(["WARNING: No ingest run today"]);
  });
});

describe("resendOpenCriticals", () => {
  it("re-sends each open critical at a later check time, and marks it sent", async () => {
    const channel = fakeChannel();
    await raiseIncident(incident(), { env: PROD, channel, now: at("15:05") });

    const results = await resendOpenCriticals({ env: PROD, channel, now: at("17:00") });

    expect(results).toEqual([{ incidentKey: "stories-missing:2026-11-09", delivery: "sent" }]);
    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(channel.send.mock.calls[1][0]).toMatch(/^CRITICAL, still open after 1h 55m: No ingest run today\n/);
    expect(channel.send.mock.calls[1][0]).toContain("Link: https://airecap.news/admin/runs/42");
    expect(fake.rows[0].notifiedAt).toEqual(at("17:00"));
  });

  it("skips a critical sent within the last hour, so one raised in the same check run is not sent twice", async () => {
    const channel = fakeChannel();
    await raiseIncident(incident(), { env: PROD, channel, now: at("17:00") });

    await expect(resendOpenCriticals({ env: PROD, channel, now: at("17:01") })).resolves.toEqual([]);
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it("leaves warnings, info, and resolved incidents alone", async () => {
    const channel = fakeChannel();
    await raiseIncident(incident({ incidentKey: "a", severity: "warning" }), { env: PROD, channel, now: at("15:05") });
    await raiseIncident(incident({ incidentKey: "b", severity: "info" }), { env: PROD, channel, now: at("15:05") });
    await raiseIncident(incident({ incidentKey: "c" }), { env: PROD, channel, now: at("15:05") });
    await resolveIncident("c", { env: PROD, channel, now: at("16:00") });
    channel.send.mockClear();

    await expect(resendOpenCriticals({ env: PROD, channel, now: at("22:00") })).resolves.toEqual([]);
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("records instead of sending outside production", async () => {
    const channel = fakeChannel();
    await raiseIncident(incident(), { env: DEV, channel, runId: RUN_ID, now: at("15:05") });

    const results = await resendOpenCriticals({ env: DEV, channel, runId: RUN_ID, now: at("17:00") });

    expect(results).toEqual([{ incidentKey: "stories-missing:2026-11-09", delivery: "recorded" }]);
    expect(channel.send).not.toHaveBeenCalled();
    expect(fake.events).toHaveLength(2);
  });
});

describe("resolveIncident", () => {
  it("resolves the open incident and posts a resolved message", async () => {
    const channel = fakeChannel();
    await raiseIncident(incident(), { env: PROD, channel, now: at("15:05") });

    const result = await resolveIncident("stories-missing:2026-11-09", {
      env: PROD,
      channel,
      now: at("17:00"),
      link: runLink(43n),
      note: "41 stories are in.",
    });

    expect(result).toEqual({ resolved: true, delivery: "sent" });
    expect(fake.rows[0]).toMatchObject({ status: "resolved", openIncidentKey: null, resolvedAt: at("17:00") });
    expect(channel.send.mock.calls[1][0]).toBe(
      [
        "RESOLVED after 1h 55m: No ingest run today",
        "41 stories are in.",
        "Link: https://airecap.news/admin/runs/43",
        "Incident: stories-missing:2026-11-09",
      ].join("\n"),
    );
  });

  it("falls back to the incident's own link", async () => {
    const channel = fakeChannel();
    await raiseIncident(incident({ severity: "warning" }), { env: PROD, channel, now: at("15:05") });

    await resolveIncident("stories-missing:2026-11-09", { env: PROD, channel, now: at("16:00") });

    expect(channel.send.mock.calls[1][0]).toContain("Link: https://airecap.news/admin/runs/42");
  });

  it("resolves quietly when the owner was never told: info, or a send that never went out", async () => {
    const channel = fakeChannel();
    await raiseIncident(incident({ incidentKey: "info", severity: "info" }), { env: PROD, channel, now: at("15:05") });
    channel.send.mockRejectedValueOnce(new Error("HTTP 502"));
    await raiseIncident(incident({ incidentKey: "unsent", severity: "warning" }), { env: PROD, channel, now: at("15:05") });
    channel.send.mockClear();

    await expect(resolveIncident("info", { env: PROD, channel, now: at("16:00") })).resolves.toEqual({
      resolved: true,
      delivery: "skipped",
    });
    await expect(resolveIncident("unsent", { env: PROD, channel, now: at("16:00") })).resolves.toEqual({
      resolved: true,
      delivery: "skipped",
    });
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("does nothing when no incident is open for the key", async () => {
    const channel = fakeChannel();

    await expect(resolveIncident("nothing-open", { env: PROD, channel, now: at("16:00") })).resolves.toEqual({
      resolved: false,
      delivery: "skipped",
    });
    expect(channel.send).not.toHaveBeenCalled();
  });
});

describe("queries for the daily summary", () => {
  it("lists info incidents seen since a time, and open incidents", async () => {
    const channel = fakeChannel();
    await raiseIncident(incident({ incidentKey: "old-info", severity: "info" }), { env: PROD, channel, now: new Date("2026-11-06T15:00:00Z") });
    await raiseIncident(incident({ incidentKey: "today-info", severity: "info" }), { env: PROD, channel, now: at("15:05") });
    await raiseIncident(incident({ incidentKey: "today-warning", severity: "warning" }), { env: PROD, channel, now: at("15:06") });

    const info = await listInfoIncidents(at("05:00"));
    const open = await listOpenIncidents();

    expect(info.map((alert) => alert.incidentKey)).toEqual(["today-info"]);
    expect(open.map((alert) => alert.incidentKey)).toEqual(["old-info", "today-info", "today-warning"]);
  });
});
