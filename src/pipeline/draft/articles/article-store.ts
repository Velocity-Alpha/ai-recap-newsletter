import type { Prisma } from "@/src/generated/prisma";
import type { ArticleAttempt } from "@/src/pipeline/draft/articles/read-article";
import type { StoryArticleRead } from "@/src/pipeline/draft/articles/read-articles";
import type { ArticleMethod, ArticleStatus } from "@/src/pipeline/draft/articles/types";
import { prisma } from "@/src/server/prisma";

/**
 * The saved copy of each story's article (`story_articles`, #120). Keyed by story and link, so a link edited on
 * the board is read again. Only read copies are reused: a story that was blocked or failed is tried again on the
 * next commit, since most failures (timeouts, 504s) do not last.
 */

export interface SavedArticleRead extends StoryArticleRead {
  readAt: Date;
}

export interface ArticleStore {
  /** Read copies for these story links. */
  findRead(keys: Array<{ storyId: number; url: string }>): Promise<SavedArticleRead[]>;
  /** Saves each read, replacing an earlier one for the same story and link. */
  save(reads: StoryArticleRead[], now: Date): Promise<void>;
}

export const prismaArticleStore: ArticleStore = {
  async findRead(keys) {
    if (keys.length === 0) return [];
    const rows = await prisma.storyArticle.findMany({ where: { storyId: { in: keys.map((key) => key.storyId) }, status: "read" } });
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

  async save(reads, now) {
    await Promise.all(
      reads.map((read) => {
        const fields = {
          status: read.status,
          method: read.method,
          finalUrl: read.finalUrl,
          text: read.text,
          chars: read.chars,
          error: read.error,
          attempts: read.attempts as unknown as Prisma.InputJsonValue,
          readMs: read.ms,
          readAt: now,
        };
        return prisma.storyArticle.upsert({
          where: { storyId_url: { storyId: read.storyId, url: read.url } },
          create: { storyId: read.storyId, url: read.url, ...fields },
          update: fields,
        });
      }),
    );
  },
};
