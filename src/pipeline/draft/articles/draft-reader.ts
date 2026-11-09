import { KEEP_AFTER_PUBLISH_DAYS, KEEP_TEXT_DAYS, type ArticleStore } from "@/src/pipeline/draft/articles/article-store";
import {
  readArticles,
  toArticleText,
  type ReadArticlesOptions,
  type ReadArticlesResult,
  type StoryArticleRead,
} from "@/src/pipeline/draft/articles/read-articles";
import type { ApprovedStory } from "@/src/pipeline/draft/content";
import type { ArticleText } from "@/src/pipeline/draft/writer";

/**
 * The draft's read-articles step (#120): clear old saved text, reuse each story's saved copy when its link has one,
 * read the rest, save what was read, and report every story's outcome so the run log can say why a story was not
 * read.
 */

/** Which draft is reading: the saved copies record the issue, for the clean-up. */
export interface ReadContext {
  issueId?: number;
}

export interface ArticleReadReport extends StoryArticleRead {
  /** True when a saved copy from an earlier commit was used. */
  reused: boolean;
  /** When the saved copy was read. */
  readAt?: Date;
}

export interface DraftArticleReaderOptions {
  /** Saved copies. Null reads every story and saves nothing (the replay script). */
  store: ArticleStore | null;
  /** Network, keys and deadline for the reads. */
  readOptions?: ReadArticlesOptions;
  /** Gets every story's outcome, in story order, after the step. */
  onReads?: (reads: ArticleReadReport[]) => void | Promise<void>;
  /** A saved-copy problem. It never fails the step: drafting reads the articles again instead. */
  onWarning?: (message: string) => void | Promise<void>;
  /** Other news for the run log, such as how many old copies had their text cleared. */
  onInfo?: (message: string) => void | Promise<void>;
  now?: () => Date;
  /** Replaces the reads (tests). */
  read?: (stories: Array<{ id: number; url: string }>, options: ReadArticlesOptions) => Promise<ReadArticlesResult>;
}

/** The optional reader keys, read from the environment here and nowhere else. */
export function readerOptionsFromEnv(env: Record<string, string | undefined>): Pick<ReadArticlesOptions, "jinaApiKey" | "githubToken"> {
  return { jinaApiKey: env.JINA_API_KEY?.trim() || undefined, githubToken: env.GITHUB_TOKEN?.trim() || undefined };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDraftArticleReader(
  options: DraftArticleReaderOptions,
): (stories: ApprovedStory[], context?: ReadContext) => Promise<ArticleText[]> {
  const now = options.now ?? (() => new Date());
  const read = options.read ?? readArticles;

  return async (stories, context = {}) => {
    const keys = stories.map((story) => ({ storyId: story.id, url: story.url }));
    const saved = new Map<number, ArticleReadReport>();
    if (options.store) {
      try {
        const cleared = await options.store.clearOldText(now());
        if (cleared > 0) {
          await options.onInfo?.(
            `Cleared the saved text of ${cleared} old ${cleared === 1 ? "article" : "articles"} (issue published over ${KEEP_AFTER_PUBLISH_DAYS} days ago, or read over ${KEEP_TEXT_DAYS} days ago).`,
          );
        }
      } catch (error) {
        await options.onWarning?.(`Could not clear old article text: ${message(error)}`);
      }
      try {
        for (const copy of await options.store.findRead(keys)) saved.set(copy.storyId, { ...copy, reused: true });
      } catch (error) {
        await options.onWarning?.(`Could not load saved articles, so every story was read: ${message(error)}`);
      }
    }

    const toRead = stories.filter((story) => !saved.has(story.id));
    const fresh = toRead.length > 0 ? await read(toRead, options.readOptions ?? {}) : { articles: [], reads: [] };
    if (options.store && fresh.reads.length > 0) {
      try {
        await options.store.save(fresh.reads, now(), { issueId: context.issueId });
      } catch (error) {
        await options.onWarning?.(`Could not save the articles read: ${message(error)}`);
      }
    }

    const freshById = new Map(fresh.reads.map((entry) => [entry.storyId, entry]));
    const reports = stories.map((story): ArticleReadReport => saved.get(story.id) ?? { ...freshById.get(story.id)!, reused: false });
    await options.onReads?.(reports);
    return reports.map(toArticleText);
  };
}

function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`;
}

/** A story's outcome for the run log's `data`. The article text stays out of the log. */
export function articleReadLogData(read: ArticleReadReport) {
  return {
    storyId: read.storyId,
    url: read.url,
    status: read.status,
    method: read.method,
    reused: read.reused,
    ms: read.ms,
    chars: read.chars,
    finalUrl: read.finalUrl,
    error: read.error,
    attempts: read.attempts,
  };
}

/** One line per story for the run log. */
export function describeArticleRead(read: ArticleReadReport): string {
  const chars = `${read.chars.toLocaleString("en-US")} characters`;
  if (read.status === "read" && read.reused) {
    const day = read.readAt ? ` on ${read.readAt.toISOString().slice(0, 10)}` : "";
    return `Story ${read.storyId}: used the copy read with ${read.method}${day} (${chars}).`;
  }
  if (read.status === "read") return `Story ${read.storyId}: read with ${read.method} in ${seconds(read.ms)} (${chars}).`;
  return `Story ${read.storyId}: not read (${read.status}) after ${seconds(read.ms)}. ${read.error ?? ""}`.trim();
}

export function summarizeArticleReads(reads: ArticleReadReport[]): string {
  if (reads.length === 0) return "No feature-section stories to read.";
  const readCount = reads.filter((entry) => entry.status === "read").length;
  const reused = reads.filter((entry) => entry.reused).length;
  const unread = reads.filter((entry) => entry.status !== "read").map((entry) => entry.storyId);
  const reusedNote = reused ? ` (${reused} saved ${reused === 1 ? "copy" : "copies"} reused)` : "";
  const unreadNote = unread.length ? ` Not read: ${unread.length === 1 ? "story" : "stories"} ${unread.join(", ")}.` : "";
  return `Read ${readCount} of ${reads.length} articles${reusedNote}.${unreadNote}`;
}
