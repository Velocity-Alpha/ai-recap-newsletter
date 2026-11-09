import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A whole bad day, in order, through the real checks, notify and alerts modules. Only the database (a small
 * in-memory `alerts` table and the run log) and fetch (Telegram, the site, Healthchecks.io) are fakes.
 * It proves the de-duplication across check times: each critical once per check time, each warning once,
 * no per-source warnings on top of a missing run, and one message to close the day.
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

  let nextRunId = 100n;
  const finished: Array<{ status: string }> = [];
  return {
    rows,
    finished,
    prisma: { alert },
    startRun: async () => nextRunId++,
    reset() {
      rows.length = 0;
      finished.length = 0;
      nextId = 1n;
      nextRunId = 100n;
    },
  };
});

vi.mock("@/src/server/prisma", () => ({ prisma: fake.prisma }));
vi.mock("@/src/pipeline/runs", () => ({
  startRun: vi.fn(fake.startRun),
  finishRun: vi.fn(async (_id: bigint, result: { status: string }) => {
    fake.finished.push(result);
  }),
  logEvent: vi.fn(async () => undefined),
}));

import { committedNoDraft, missingRun, normalDay } from "@/src/pipeline/checks/day-facts.fixture";
import type { DayFacts } from "@/src/pipeline/checks/day-facts";
import { runChecks } from "@/src/pipeline/checks/run-checks";

const ENV = {
  APP_ENV: "production",
  TELEGRAM_REVIEW_BOT_TOKEN: "test-token",
  TELEGRAM_OPS_CHAT_ID: "-100555",
  HEALTHCHECKS_PING_URL: "https://hc-ping.example/day",
};

let telegram: string[];
let pings: string[];

const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const target = String(url);
  if (target.startsWith("https://api.telegram.org/bottest-token/")) {
    telegram.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response("{}");
  }
  if (target.startsWith(ENV.HEALTHCHECKS_PING_URL)) {
    pings.push(target);
    return new Response("OK");
  }
  throw new Error(`unexpected fetch ${target}`);
});

async function checkAt(iso: string, facts: DayFacts): Promise<string[]> {
  const before = telegram.length;
  await runChecks({ env: ENV, now: () => new Date(iso), fetch: fetchFake as unknown as typeof fetch, readFacts: async () => facts });
  return telegram.slice(before).map((text) => text.split("\n")[0]);
}

beforeEach(() => {
  fake.reset();
  telegram = [];
  pings = [];
  fetchFake.mockClear();
});

describe("a whole day of checks", () => {
  it("alerts once per problem, repeats only open criticals, and closes the day with one message", async () => {
    // Tuesday 2026-11-10, EST. 10:05: no ingest run and no stories.
    expect(await checkAt("2026-11-10T15:05:00Z", missingRun())).toEqual([
      "CRITICAL: No ingest run today (2026-11-10).",
      "CRITICAL: No stories today.",
    ]);

    // 12:00: still nothing, and no commit. The criticals repeat once; nothing else repeats.
    expect(await checkAt("2026-11-10T17:00:00Z", missingRun())).toEqual([
      "WARNING: No commit for 2026-11-10 yet.",
      "CRITICAL, still open after 1h 55m: No ingest run today (2026-11-10).",
      "CRITICAL, still open after 1h 55m: No stories today.",
    ]);

    // 18:00: a late run brought the stories and the owner committed, but no draft is ready.
    expect(await checkAt("2026-11-10T23:00:00Z", committedNoDraft())).toEqual([
      "RESOLVED after 7h 55m: No ingest run today (2026-11-10).",
      "RESOLVED after 7h 55m: No stories today.",
      "RESOLVED after 6h 0m: No commit for 2026-11-10 yet.",
      "CRITICAL: Committed, but no draft is ready for 2026-11-10.",
      "Daily summary: Tuesday 2026-11-10",
    ]);
    expect(pings).toEqual([ENV.HEALTHCHECKS_PING_URL]);

    // Wednesday 10:05: a normal day. Tuesday's open critical closes with one message.
    const wednesday = normalDay({
      date: "2026-11-11",
      weekday: "Wed",
      ingestRun: { id: "42", status: "succeeded", startedAt: new Date("2026-11-11T14:55:00Z") },
    });
    expect(await checkAt("2026-11-11T15:05:00Z", wednesday)).toEqual([
      "RESOLVED: closed 1 incident from earlier days. Their day is over, so their checks no longer run.",
    ]);

    expect(telegram).toHaveLength(11);
    expect(fake.rows.filter((row) => row.status === "open")).toEqual([]);
    expect(fake.rows.map((row) => row.incidentKey)).toEqual([
      "ingest-run-missing:2026-11-10",
      "stories-thin:2026-11-10",
      "commit-missing:2026-11-10",
      "draft-missing:2026-11-10",
    ]);
    expect(fake.finished.map((run) => run.status)).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);
  });

  it("sends nothing new when the same check time runs twice", async () => {
    await checkAt("2026-11-10T17:00:00Z", missingRun());
    expect(await checkAt("2026-11-10T17:03:00Z", missingRun())).toEqual([]);
  });
});
