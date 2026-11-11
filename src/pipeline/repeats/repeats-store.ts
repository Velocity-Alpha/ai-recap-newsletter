import type { MatchStory, RepeatsStore } from "@/src/pipeline/repeats/match-stories";
import { WINDOW_SETTING, windowDaysFromSetting } from "@/src/pipeline/repeats/repeat-rules";
import { readSetting } from "@/src/pipeline/settings";
import { prisma } from "@/src/server/prisma";

const toDay = (day: string) => new Date(`${day}T00:00:00Z`);
const fromDay = (date: Date) => date.toISOString().slice(0, 10);

const STORY_FIELDS = { id: true, day: true, headline: true, summary: true } as const;

function toMatchStory(row: { id: number; day: Date | null; headline: string | null; summary: string | null }): MatchStory | null {
  return row.day ? { id: row.id, day: fromDay(row.day), headline: row.headline, summary: row.summary } : null;
}

const present = <T>(value: T | null): value is T => value !== null;

/** The window of the repeat check, in days: the `repeats.window_days` setting, default 14. */
export async function readRepeatWindowDays(): Promise<number> {
  return windowDaysFromSetting(await readSetting(WINDOW_SETTING));
}

/** Ids of the stories the check has not gone through, with `day` on or after `since` (YYYY-MM-DD). */
export async function findUnmatchedStoryIds(since: string): Promise<number[]> {
  const rows = await prisma.story.findMany({ where: { matchedAt: null, day: { gte: toDay(since) } }, select: { id: true } });
  return rows.map((row) => row.id);
}

export function createPrismaRepeatsStore(): RepeatsStore {
  return {
    async loadUnmatched(ids) {
      const rows = await prisma.story.findMany({ where: { id: { in: ids }, matchedAt: null, day: { not: null } }, select: STORY_FIELDS });
      return rows.map(toMatchStory).filter(present);
    },

    async loadStoriesByDay(from, to) {
      const rows = await prisma.story.findMany({ where: { day: { gte: toDay(from), lte: toDay(to) } }, select: STORY_FIELDS });
      return rows.map(toMatchStory).filter(present);
    },

    async loadEmbeddings(ids) {
      if (ids.length === 0) return [];
      return prisma.storyEmbedding.findMany({ where: { storyId: { in: ids } }, select: { storyId: true, vector: true } });
    },

    async saveEmbeddings(rows) {
      await prisma.storyEmbedding.createMany({ data: rows, skipDuplicates: true });
    },

    async loadMatchedPairs(ids) {
      const rows = await prisma.storyMatch.findMany({
        where: { OR: [{ newerStoryId: { in: ids } }, { olderStoryId: { in: ids } }] },
        select: { newerStoryId: true, olderStoryId: true },
      });
      return rows.map((row) => [row.newerStoryId, row.olderStoryId]);
    },

    async saveMatches(rows) {
      await prisma.storyMatch.createMany({ data: rows, skipDuplicates: true });
    },

    async markMatched(ids, at) {
      await prisma.story.updateMany({ where: { id: { in: ids } }, data: { matchedAt: at } });
    },
  };
}
