import { createNodeFetch, HostLimiter, type FetchLike } from "@/src/pipeline/draft/articles/http";
import { readArticle, type ArticleRead, type ReadArticleOptions } from "@/src/pipeline/draft/articles/read-article";
import type { ArticleText } from "@/src/pipeline/draft/writer";

/**
 * Reads the articles of a draft's feature-section stories (#120), all at once, with a deadline for the whole step
 * (#170: 120 s; the draft job is a background function). It is the only limit on waiting for a host or text worker
 * slot. A story still being read at the deadline comes back unread, so drafting goes on from its summary.
 */

export const DEFAULT_DEADLINE_MS = 120_000;
/** #115: keep at most 2 requests per host at once. */
const PER_HOST = 2;

export interface StoryArticleRead extends ArticleRead {
  storyId: number;
}

export interface ReadArticlesOptions extends Omit<ReadArticleOptions, "fetch" | "signal" | "limiter"> {
  /** Defaults to the real network, behind the address guard. */
  fetch?: FetchLike;
  deadlineMs?: number;
}

export interface ReadArticlesResult {
  /** For the writer: text, or `unread`, per story, in the given order. */
  articles: ArticleText[];
  /** Per-story diagnostics: status, method, timings, characters, and why a story was not read. */
  reads: StoryArticleRead[];
}

class DeadlineError extends Error {
  constructor(ms: number) {
    super(`Stopped at the ${ms / 1000} s deadline for reading articles.`);
    this.name = "DeadlineError";
  }
}

export function toArticleText(read: StoryArticleRead): ArticleText {
  return read.status === "read" && read.text ? { storyId: read.storyId, text: read.text } : { storyId: read.storyId, unread: true };
}

export async function readArticles(stories: Array<{ id: number; url: string }>, options: ReadArticlesOptions = {}): Promise<ReadArticlesResult> {
  if (stories.length === 0) return { articles: [], reads: [] };
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DeadlineError(deadlineMs)), deadlineMs);
  const limiter = new HostLimiter(PER_HOST);
  const fetch = options.fetch ?? createNodeFetch();

  try {
    const reads = await Promise.all(
      stories.map(async (story): Promise<StoryArticleRead> => ({
        storyId: story.id,
        ...(await readArticle(story.url, { ...options, fetch, signal: deadline.signal, limiter })),
      })),
    );
    return { articles: reads.map(toArticleText), reads };
  } finally {
    clearTimeout(timer);
  }
}
