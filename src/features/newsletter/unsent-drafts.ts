import { prisma } from "@/src/server/prisma";

/**
 * Matches the board's candidate window. A draft approved further back only
 * holds stories that are too old to be candidates anyway.
 */
const UNSENT_DRAFT_LOOKBACK_DAYS = 3;

/** Stories approved for an earlier issue date that was never sent. */
export interface UnsentDraft {
  /** Issue date the stories were approved for (YYYY-MM-DD). */
  date: string;
  storyIds: number[];
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function fromDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Finds approved drafts for earlier dates that are still unsent.
 *
 * A story counts while it is queued for an earlier date in the candidate
 * window and has not run in an issue. A date with a published issue is not a
 * draft any more. Committing the stories in a later issue re-queues them for
 * that date, so a skipped draft drops out on its own.
 */
export async function findUnsentDrafts(targetDateOnly: string): Promise<UnsentDraft[]> {
  const target = fromDateOnly(targetDateOnly);
  const windowStart = new Date(target);
  windowStart.setUTCDate(windowStart.getUTCDate() - UNSENT_DRAFT_LOOKBACK_DAYS);

  const queued = await prisma.story.findMany({
    where: {
      queuedForPublicationDate: { gte: windowStart, lt: target },
      usedInPublicationDate: null,
    },
    select: { id: true, queuedForPublicationDate: true },
    orderBy: [{ queuedForPublicationDate: "desc" }, { id: "asc" }],
  });
  if (queued.length === 0) return [];

  const storyIdsByDate = new Map<string, number[]>();
  for (const story of queued) {
    if (!story.queuedForPublicationDate) continue;
    const date = toDateOnly(story.queuedForPublicationDate);
    const ids = storyIdsByDate.get(date) ?? [];
    ids.push(Number(story.id));
    storyIdsByDate.set(date, ids);
  }

  const published = await prisma.issue.findMany({
    where: {
      publishedAt: { not: null },
      issueDate: { in: Array.from(storyIdsByDate.keys(), fromDateOnly) },
    },
    select: { issueDate: true },
  });
  const sentDates = new Set(
    published.flatMap((issue) => (issue.issueDate ? [toDateOnly(issue.issueDate)] : []))
  );

  return Array.from(storyIdsByDate, ([date, storyIds]) => ({ date, storyIds })).filter(
    (draft) => !sentDates.has(draft.date)
  );
}
