import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  pipelineRun: { findMany: vi.fn(), findUnique: vi.fn() },
}));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import {
  getRunDetail,
  listRecentRuns,
  parseRunId,
  summarizeStats,
  toRunRow,
} from "@/src/features/admin/runs";

const STARTED = new Date("2026-11-09T14:55:00Z");

function run(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id: BigInt(id),
    job: "ingest-stories",
    trigger: "schedule",
    status: "succeeded",
    startedAt: STARTED,
    finishedAt: new Date(STARTED.getTime() + 16_200),
    stats: null,
    error: null,
    ...overrides,
  };
}

describe("parseRunId", () => {
  it("accepts a positive whole number only", () => {
    expect(parseRunId("12")).toBe(12n);
    for (const raw of ["", "0", "-1", "1.5", "abc", "1e3", undefined, null, "9".repeat(25)]) {
      expect(parseRunId(raw)).toBeNull();
    }
  });
});

describe("summarizeStats", () => {
  it("lists top-level values, and counts arrays", () => {
    expect(
      summarizeStats({
        owner: "native",
        targetDate: "2026-11-09",
        storiesSaved: 42,
        telegram: "sent",
        sources: [{ source: "a" }, { source: "b" }],
      }),
    ).toBe("owner native · targetDate 2026-11-09 · storiesSaved 42 · telegram sent · sources 2");
  });

  it("shows null and nested objects without dumping them", () => {
    expect(summarizeStats({ from: null, to: "native", nested: { a: 1 } })).toBe("from null · to native · nested {…}");
  });

  it("stops after six values", () => {
    expect(summarizeStats({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 })).toBe("a 1 · b 2 · c 3 · d 4 · e 5 · f 6 · …");
  });

  it("is empty when there are no stats", () => {
    expect(summarizeStats(null)).toBe("");
    expect(summarizeStats(3)).toBe("3");
  });
});

describe("toRunRow", () => {
  it("maps a finished run with its duration and stats summary", () => {
    expect(toRunRow(run(5, { stats: { storiesSaved: 3 } }))).toEqual({
      id: "5",
      job: "ingest-stories",
      trigger: "schedule",
      status: "succeeded",
      startedAt: STARTED,
      finishedAt: new Date(STARTED.getTime() + 16_200),
      durationMs: 16_200,
      statsSummary: "storiesSaved 3",
      error: null,
    });
  });

  it("has no duration while the run is still going", () => {
    expect(toRunRow(run(6, { status: "running", finishedAt: null })).durationMs).toBeNull();
  });
});

describe("listRecentRuns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the newest runs first, one extra to know if older ones exist", async () => {
    prismaMock.pipelineRun.findMany.mockResolvedValueOnce([run(9), run(8), run(7)]);

    const page = await listRecentRuns({ limit: 2 });

    expect(prismaMock.pipelineRun.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { id: "desc" }, take: 3 });
    expect(page.runs.map((row) => row.id)).toEqual(["9", "8"]);
    expect(page.olderBefore).toBe("8");
  });

  it("pages back from a run id, and stops when nothing older is left", async () => {
    prismaMock.pipelineRun.findMany.mockResolvedValueOnce([run(7)]);

    const page = await listRecentRuns({ before: 8n, limit: 2 });

    expect(prismaMock.pipelineRun.findMany).toHaveBeenCalledWith({
      where: { id: { lt: 8n } },
      orderBy: { id: "desc" },
      take: 3,
    });
    expect(page.runs.map((row) => row.id)).toEqual(["7"]);
    expect(page.olderBefore).toBeNull();
  });
});

describe("getRunDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the run, its full stats, and its events in order", async () => {
    prismaMock.pipelineRun.findUnique.mockResolvedValueOnce({
      ...run(5, { status: "failed", error: "1 source(s) had errors: TLDR AI.", stats: { storiesSaved: 3 } }),
      events: [
        {
          id: 40n,
          runId: 5n,
          level: "info",
          step: "source",
          message: "The Signal: ok",
          data: { stories: 3 },
          createdAt: new Date("2026-11-09T14:55:05Z"),
        },
        {
          id: 41n,
          runId: 5n,
          level: "error",
          step: "source",
          message: "TLDR AI: failed.",
          data: null,
          createdAt: new Date("2026-11-09T14:55:09Z"),
        },
      ],
    });

    const detail = await getRunDetail(5n);

    expect(prismaMock.pipelineRun.findUnique).toHaveBeenCalledWith({
      where: { id: 5n },
      include: { events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    expect(detail?.run).toMatchObject({ id: "5", status: "failed", error: "1 source(s) had errors: TLDR AI." });
    expect(detail?.stats).toBe('{\n  "storiesSaved": 3\n}');
    expect(detail?.events).toEqual([
      {
        id: "40",
        at: new Date("2026-11-09T14:55:05Z"),
        level: "info",
        step: "source",
        message: "The Signal: ok",
        data: '{\n  "stories": 3\n}',
      },
      { id: "41", at: new Date("2026-11-09T14:55:09Z"), level: "error", step: "source", message: "TLDR AI: failed.", data: null },
    ]);
  });

  it("returns null for a missing run", async () => {
    prismaMock.pipelineRun.findUnique.mockResolvedValueOnce(null);

    await expect(getRunDetail(404n)).resolves.toBeNull();
  });
});
