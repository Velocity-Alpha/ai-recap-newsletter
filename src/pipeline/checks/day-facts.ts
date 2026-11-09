import { newYorkTime, type Weekday } from "@/src/pipeline/checks/schedule";
import { dateOnly, findSkippedDate } from "@/src/pipeline/checks/skipped-dates";
import { readSetting } from "@/src/pipeline/settings";
import { prisma } from "@/src/server/prisma";

/**
 * Everything the checks need to know about one New York date. The checks are pure functions of these facts;
 * readDayFacts is the only place that knows which tables hold them.
 */
export interface DayFacts {
  /** YYYY-MM-DD, New York. */
  date: string;
  weekday: Weekday;
  /** Set when the owner pressed "No issue today" for this date. */
  skipped: { note: string | null; createdAt: Date } | null;
  /** `ingest.owner`. While n8n ingests there is no ingest run to look for. */
  ingestOwner: "n8n" | "native";
  /** The latest `ingest-stories` run that started on this date. */
  ingestRun: { id: string; status: string; startedAt: Date } | null;
  /** Stories ingested on this date (created in the New York day), by `stories.source`. */
  storiesBySource: Record<string, number>;
  storyTotal: number;
  /** Stories ingested on the same weekday in the 8 weeks before. Days without stories are left out. */
  weekdayTotals: number[];
  /** On how many of those days each source had stories. */
  sourceWeekdays: Record<string, number>;
  /** Stories queued for this date. */
  queuedStories: number;
  committed: boolean;
  /** About when the outline was committed. */
  commitTime: Date | null;
  /** Drafts made for this date. */
  draftsMade: number;
  /** A draft for this date has its email HTML. */
  draftReady: boolean;
  /** The published issue for this date, else the latest ready draft. */
  issue: { id: string; slug: string | null; title: string; publishedAt: Date | null } | null;
}

// Copied, not imported: run-ingest.ts would pull the OpenAI and Gmail clients into this function's bundle.
const INGEST_JOB = "ingest-stories";
const INGEST_OWNER_KEY = "ingest.owner";

const HISTORY_WEEKS = 8;
const DAY_MS = 24 * 3_600_000;
const WEEKDAYS: Weekday[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shiftDays(date: string, days: number): string {
  return new Date(dateOnly(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** The New York day as a UTC range: 23 or 25 hours on the daylight-saving switch days. */
function newYorkDayRange(date: string): { gte: Date; lt: Date } {
  return { gte: newYorkTime(date, "00:00"), lt: newYorkTime(shiftDays(date, 1), "00:00") };
}

/** Stories created in the range, by source. A missing source counts as "unknown". */
async function storiesBySourceIn(range: { gte: Date; lt: Date }): Promise<Record<string, number>> {
  const rows = await prisma.story.groupBy({ by: ["source"], where: { createdAt: range }, _count: { _all: true } });
  return Object.fromEntries(rows.map((row) => [row.source ?? "unknown", row._count._all]));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function earliest(...dates: Array<Date | null>): Date | null {
  const known = dates.filter((date): date is Date => date !== null);
  return known.length === 0 ? null : new Date(Math.min(...known.map((date) => date.getTime())));
}

/**
 * Reads the facts from the tables n8n and the native jobs write today:
 * - stories: counted by ingest time (`createdAt` in the New York day), not by `stories.day`. `day` is the
 *   newsletter's own date, often the day before for late senders, so by `day` several sources look empty
 *   most mornings (on the production copy, AI Breakfast on 7 of 8 Tuesdays; by ingest time, 1 of 8).
 *   The same weekday in the 8 weeks before, by source, gives the thin-day median and the usual senders.
 * - commit: stories whose `queued_for_publication_date` is the date (n8n sets it on commit). n8n stores no
 *   commit time, so it is about the earlier of the first draft row and the queued stories' last update.
 * - drafts: `issues` rows for the date (n8n inserts one per commit). Ready = the row has its email HTML.
 * - published: that issue's `published_at`.
 * When native drafting lands, read the commit from `approval_outlines.committed_at` (#75) and the drafts from
 * `issue_drafts` with status `ready` (#76) here. The checks do not change.
 */
export async function readDayFacts(date: string): Promise<DayFacts> {
  const day = dateOnly(date);
  const today = newYorkDayRange(date);
  const history = Array.from({ length: HISTORY_WEEKS }, (_, index) => newYorkDayRange(shiftDays(date, -7 * (index + 1))));

  const [skipped, ingestOwner, ingestRun, storiesBySource, historyBySource, queued, drafts, readyIssues] = await Promise.all([
    findSkippedDate(date),
    readSetting(INGEST_OWNER_KEY),
    prisma.pipelineRun.findFirst({
      where: { job: INGEST_JOB, startedAt: today },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, startedAt: true },
    }),
    storiesBySourceIn(today),
    Promise.all(history.map(storiesBySourceIn)),
    prisma.story.aggregate({
      where: { queuedForPublicationDate: day },
      _count: { _all: true },
      _min: { updatedAt: true },
    }),
    prisma.issue.aggregate({ where: { issueDate: day }, _count: { _all: true }, _min: { createdAt: true } }),
    prisma.issue.findMany({
      where: { issueDate: day, html: { not: null } },
      select: { id: true, slug: true, title: true, publishedAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const historyDays = historyBySource.filter((counts) => sum(Object.values(counts)) > 0);
  const sourceWeekdays: Record<string, number> = {};
  for (const counts of historyDays) {
    for (const [source, count] of Object.entries(counts)) {
      if (count > 0) sourceWeekdays[source] = (sourceWeekdays[source] ?? 0) + 1;
    }
  }
  const issue = readyIssues.find((row) => row.publishedAt) ?? readyIssues[0] ?? null;
  const draftsMade = drafts._count._all;
  const committed = queued._count._all > 0 || draftsMade > 0;
  return {
    date,
    weekday: WEEKDAYS[day.getUTCDay()],
    skipped: skipped && { note: skipped.note, createdAt: skipped.createdAt },
    ingestOwner: ingestOwner === "native" ? "native" : "n8n",
    ingestRun: ingestRun && { id: ingestRun.id.toString(), status: ingestRun.status, startedAt: ingestRun.startedAt },
    storiesBySource,
    storyTotal: sum(Object.values(storiesBySource)),
    weekdayTotals: historyDays.map((counts) => sum(Object.values(counts))),
    sourceWeekdays,
    queuedStories: queued._count._all,
    committed,
    commitTime: committed ? earliest(queued._min.updatedAt ?? null, drafts._min.createdAt ?? null) : null,
    draftsMade,
    draftReady: readyIssues.length > 0,
    issue: issue && { id: issue.id.toString(), slug: issue.slug, title: issue.title, publishedAt: issue.publishedAt },
  };
}
