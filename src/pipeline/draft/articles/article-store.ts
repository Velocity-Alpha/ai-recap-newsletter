import type { Prisma } from "@/src/generated/prisma";
import { MAX_TEXT_CHARS, type ArticleAttempt } from "@/src/pipeline/draft/articles/read-article";
import type { StoryArticleRead } from "@/src/pipeline/draft/articles/read-articles";
import type { ArticleMethod, ArticleStatus } from "@/src/pipeline/draft/articles/types";
import { prisma } from "@/src/server/prisma";

/**
 * The saved copy of each story's article (`story_articles`, #120). Keyed by story and link, so a link edited on
 * the board is read again. Only read copies with their text are reused: a story that was blocked or failed is tried
 * again on the next commit, since most failures (timeouts, 504s) do not last.
 *
 * Article text is someone else's writing, so it is not kept for long: `clearOldText` empties it once the issue that
 * read it was published over 14 days ago, or 30 days after the read in any case. The rest of the row stays.
 */

/** Text is cleared this long after the issue that read it was published. */
export const KEEP_AFTER_PUBLISH_DAYS = 14;
/** Text is cleared this long after it was read, published or not. */
export const KEEP_TEXT_DAYS = 30;
/** Rows cleared per draft job at most, so the clean-up stays quick. Each draft adds about 8. */
export const CLEAR_BATCH = 200;

export interface SavedArticleRead extends StoryArticleRead {
  readAt: Date;
}

export interface ArticleStore {
  /** Read copies, with their text, for these story links. */
  findRead(keys: Array<{ storyId: number; url: string }>): Promise<SavedArticleRead[]>;
  /** Saves each read, replacing an earlier one for the same story and link. */
  save(reads: StoryArticleRead[], now: Date, context?: { issueId?: number }): Promise<void>;
  /** Clears the text of old copies (see above), at most CLEAR_BATCH rows. Returns how many it cleared. */
  clearOldText(now: Date): Promise<number>;
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export const prismaArticleStore: ArticleStore = {
  async findRead(keys) {
    if (keys.length === 0) return [];
    const rows = await prisma.storyArticle.findMany({
      where: { storyId: { in: keys.map((key) => key.storyId) }, status: "read", text: { not: null } },
    });
    const wanted = new Set(keys.map((key) => `${key.storyId} ${key.url}`));
    return rows
      .filter((row) => wanted.has(`${row.storyId} ${row.url}`))
      .map((row) => ({
        storyId: row.storyId,
        url: row.url,
        status: row.status as ArticleStatus,
        method: row.method as ArticleMethod | null,
        text: row.text,
        finalUrl: row.finalUrl,
        chars: row.chars,
        ms: row.readMs ?? 0,
        error: row.error,
        attempts: (row.attempts ?? []) as unknown as ArticleAttempt[],
        readAt: row.readAt,
      }));
  },

  async save(reads, now, context = {}) {
    await Promise.all(
      reads.map((read) => {
        const fields = {
          status: read.status,
          method: read.method,
          finalUrl: read.finalUrl,
          // The reader already cuts the text; the store holds the cap whatever it is given.
          text: read.text === null ? null : read.text.slice(0, MAX_TEXT_CHARS),
          chars: read.chars,
          error: read.error,
          attempts: read.attempts as unknown as Prisma.InputJsonValue,
          readMs: read.ms,
          readAt: now,
          ...(context.issueId === undefined ? {} : { issueId: BigInt(context.issueId) }),
        };
        return prisma.storyArticle.upsert({
          where: { storyId_url: { storyId: read.storyId, url: read.url } },
          create: { storyId: read.storyId, url: read.url, ...fields },
          update: fields,
        });
      }),
    );
  },

  async clearOldText(now) {
    const readBefore = daysBefore(now, KEEP_TEXT_DAYS);
    // A copy is read before its issue is published, so issues published before `readBefore` only have copies the
    // 30-day rule clears anyway. That keeps this list to about two weeks of issues.
    const issues = await prisma.issue.findMany({
      where: { publishedAt: { lt: daysBefore(now, KEEP_AFTER_PUBLISH_DAYS), gte: readBefore } },
      select: { id: true },
    });
    const rows = await prisma.storyArticle.findMany({
      where: {
        text: { not: null },
        OR: [{ readAt: { lt: readBefore } }, ...(issues.length > 0 ? [{ issueId: { in: issues.map((issue) => issue.id) } }] : [])],
      },
      select: { id: true },
      orderBy: { readAt: "asc" },
      take: CLEAR_BATCH,
    });
    if (rows.length === 0) return 0;
    const { count } = await prisma.storyArticle.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { text: null } });
    return count;
  },
};
