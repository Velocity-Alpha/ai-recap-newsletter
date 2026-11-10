import { newYorkTime, shiftDate, type Weekday } from "@/src/pipeline/checks/schedule";
import { ISSUE_DRAFT, ISSUE_PUBLISHED, type IssueStatus } from "@/src/features/newsletter/issue-status";
import { dateOnly, findSkippedDate } from "@/src/pipeline/checks/skipped-dates";
import { stagedFacts } from "@/src/pipeline/distribution/issue-state";
import { readDateIssueFacts } from "@/src/pipeline/distribution/issue-state-store";
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
  /** The latest `ingest-stories` run that started on this date. */
  ingestRun: { id: string; status: string; startedAt: Date } | null;
  /** Stories ingested on this date (created in the New York day), by `stories.source`. */
  storiesBySource: Record<string, number>;
  storyTotal: number;
  /** Stories ingested on the same weekday in the 8 weeks before. Days without stories are left out. */
  weekdayTotals: number[];
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
  issue: { id: string; slug: string | null; title: string; status: IssueStatus; publishedAt: Date | null } | null;
  /** The number of the issue's newest staged version (GLOSSARY.md). Null when nothing is staged. */
  stagedVersion: number | null;
  /** The draft changed after that version was staged: another draft row, title, or image. */
  changedSinceStaged: boolean;
  /** Facts that could not be read and fell back to a default. The run logs them as warnings. */
  warnings: string[];
}

// Copied, not imported: run-ingest.ts would pull the OpenAI and Gmail clients into this function's bundle.
const INGEST_JOB = "ingest-stories";

const HISTORY_WEEKS = 8;
const WEEKDAYS: Weekday[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The New York day as a UTC range: 23 or 25 hours on the daylight-saving switch days. */
function newYorkDayRange(date: string): { gte: Date; lt: Date } {
  return { gte: newYorkTime(date, "00:00"), lt: newYorkTime(shiftDate(date, 1), "00:00") };
}

/** Stories created in the range, by source. A missing source counts as "unknown". */
async function storiesBySourceIn(range: { gte: Date; lt: Date }): Promise<Record<string, number>> {
  const rows = await prisma.story.groupBy({ by: ["source"], where: { createdAt: range }, _count: { _all: true } });
  return Object.fromEntries(rows.map((row) => [row.source ?? "unknown", row._count._all]));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function shortReason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 300);
}

function earliest(...dates: Array<Date | null>): Date | null {
  const known = dates.filter((date): date is Date => date !== null);
  return known.length === 0 ? null : new Date(Math.min(...known.map((date) => date.getTime())));
}

/**
 * Reads the facts from these tables:
 * - stories: counted by ingest time (`createdAt` in the New York day), not by `stories.day`. `day` is the
 *   newsletter's own date, often the day before for late senders, so by `day` several sources look empty
 *   most mornings (on the production copy, AI Breakfast on 7 of 8 Tuesdays; by ingest time, 1 of 8).
 *   The same weekday in the 8 weeks before gives the thin-day median. Which sources are expected on a
 *   weekday is fixed per source (`expectedOn` in sources.ts), not read from this history.
 * - commit: stories whose `queued_for_publication_date` is the date (the commit sets it). The commit time is
 *   about the earlier of the issue row's creation and the queued stories' last update.
 * - drafts: the `issues` row for the date. Ready = the row has its email HTML.
 * - published: that issue's `status`.
 * - staged: the issue's newest staged version and whether the draft changed after it (`stagedFacts`, #149).
 */
export async function readDayFacts(date: string): Promise<DayFacts> {
  const warnings: string[] = [];
  // A missing skipped_dates table (migration not applied) must not stop the checks: the date counts as not
  // skipped, and the run log says why.
  const readSkipped = findSkippedDate(date).catch((error: unknown) => {
    warnings.push(`Could not read skipped_dates, so ${date} counts as not skipped: ${shortReason(error)}`);
    return null;
  });
  // The same for staged_versions: the date then counts as not staged.
  const readStaged = readDateIssueFacts(date)
    .then(stagedFacts)
    .catch((error: unknown) => {
      warnings.push(`Could not read the staged versions, so ${date} counts as not staged: ${shortReason(error)}`);
      return { stagedVersion: null, changedSinceStaged: false };
    });
  const day = dateOnly(date);
  const today = newYorkDayRange(date);
  const history = Array.from({ length: HISTORY_WEEKS }, (_, index) => newYorkDayRange(shiftDate(date, -7 * (index + 1))));

  const [skipped, staged, ingestRun, storiesBySource, historyBySource, queued, drafts, readyIssues] = await Promise.all([
    readSkipped,
    readStaged,
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
      select: { id: true, slug: true, title: true, status: true, publishedAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const historyDays = historyBySource.filter((counts) => sum(Object.values(counts)) > 0);
  const issue = readyIssues.find((row) => row.status === ISSUE_PUBLISHED) ?? readyIssues[0] ?? null;
  const draftsMade = drafts._count._all;
  const committed = queued._count._all > 0 || draftsMade > 0;
  return {
    date,
    weekday: WEEKDAYS[day.getUTCDay()],
    skipped: skipped && { note: skipped.note, createdAt: skipped.createdAt },
    ingestRun: ingestRun && { id: ingestRun.id.toString(), status: ingestRun.status, startedAt: ingestRun.startedAt },
    storiesBySource,
    storyTotal: sum(Object.values(storiesBySource)),
    weekdayTotals: historyDays.map((counts) => sum(Object.values(counts))),
    queuedStories: queued._count._all,
    committed,
    commitTime: committed ? earliest(queued._min.updatedAt ?? null, drafts._min.createdAt ?? null) : null,
    draftsMade,
    draftReady: readyIssues.length > 0,
    issue: issue && {
      id: issue.id.toString(),
      slug: issue.slug,
      title: issue.title,
      status: issue.status === ISSUE_PUBLISHED ? ISSUE_PUBLISHED : ISSUE_DRAFT,
      publishedAt: issue.publishedAt,
    },
    stagedVersion: staged.stagedVersion,
    changedSinceStaged: staged.changedSinceStaged,
    warnings,
  };
}
