import type { PipelineEvent, PipelineRun, Prisma } from "@/src/generated/prisma";
import { prisma } from "@/src/server/prisma";

/** Runs and their events for /admin/runs. Ids are strings here: BigInt does not cross into JSON or props. */

export const RUNS_PAGE_SIZE = 50;
/** A long poll can log thousands of steps; the run page shows this many and counts the rest. */
export const EVENTS_SHOWN = 500;
const STATS_SUMMARY_VALUES = 6;

export type RunRow = {
  id: string;
  job: string;
  trigger: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  /** Null while the run is still going. */
  durationMs: number | null;
  statsSummary: string;
  error: string | null;
};

export type EventRow = { id: string; at: Date; level: string; step: string; message: string; data: string | null };

/** A run id from the URL: a positive whole number, or null. */
export function parseRunId(raw: string | null | undefined): bigint | null {
  if (!raw || !/^[1-9]\d{0,17}$/.test(raw)) return null;
  return BigInt(raw);
}

/** One line from a run's stats: top-level values, array sizes, and `{…}` for nested objects. */
export function summarizeStats(stats: Prisma.JsonValue | null): string {
  if (stats === null || stats === undefined) return "";
  if (typeof stats !== "object" || Array.isArray(stats)) return JSON.stringify(stats);

  const entries = Object.entries(stats);
  const parts = entries.slice(0, STATS_SUMMARY_VALUES).map(([key, value]) => {
    if (Array.isArray(value)) return `${key} ${value.length}`;
    if (value !== null && typeof value === "object") return `${key} {…}`;
    return `${key} ${value === null ? "null" : String(value)}`;
  });
  if (entries.length > STATS_SUMMARY_VALUES) parts.push("…");
  return parts.join(" · ");
}

function prettyJson(value: Prisma.JsonValue | null): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value, null, 2);
}

export function toRunRow(run: PipelineRun): RunRow {
  return {
    id: run.id.toString(),
    job: run.job,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
    statsSummary: summarizeStats(run.stats),
    error: run.error,
  };
}

function toEventRow(event: PipelineEvent): EventRow {
  return {
    id: event.id.toString(),
    at: event.createdAt,
    level: event.level,
    step: event.step,
    message: event.message,
    data: prettyJson(event.data),
  };
}

/**
 * Newest runs first. Ids grow with each run's start (startRun inserts at the start), so id order is start
 * order, and `before` pages back from a run id.
 */
export async function listRecentRuns(
  options: { before?: bigint | null; limit?: number } = {},
): Promise<{ runs: RunRow[]; olderBefore: string | null }> {
  const limit = options.limit ?? RUNS_PAGE_SIZE;
  const rows = await prisma.pipelineRun.findMany({
    where: options.before ? { id: { lt: options.before } } : {},
    orderBy: { id: "desc" },
    take: limit + 1,
  });
  const runs = rows.slice(0, limit).map(toRunRow);
  return { runs, olderBefore: rows.length > limit ? runs[runs.length - 1].id : null };
}

export type RunDetail = {
  run: RunRow;
  stats: string | null;
  /** The first EVENTS_SHOWN steps, in order. */
  events: EventRow[];
  /** Steps after those, not loaded. */
  moreEvents: number;
};

export async function getRunDetail(id: bigint): Promise<RunDetail | null> {
  const run = await prisma.pipelineRun.findUnique({
    where: { id },
    include: {
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: EVENTS_SHOWN },
      _count: { select: { events: true } },
    },
  });
  if (!run) return null;
  return {
    run: toRunRow(run),
    stats: prettyJson(run.stats),
    events: run.events.map(toEventRow),
    moreEvents: Math.max(0, run._count.events - run.events.length),
  };
}
