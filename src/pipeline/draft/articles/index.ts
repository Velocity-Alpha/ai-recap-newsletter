/** The article reader (#120). The read order and limits come from #115 (docs/research/article-reading.md). */
export {
  CLEAR_BATCH,
  KEEP_AFTER_PUBLISH_DAYS,
  KEEP_TEXT_DAYS,
  prismaArticleStore,
  type ArticleStore,
  type SavedArticleRead,
} from "@/src/pipeline/draft/articles/article-store";
export {
  articleReadLogData,
  createDraftArticleReader,
  describeArticleRead,
  readerOptionsFromEnv,
  summarizeArticleReads,
  type ArticleReadReport,
  type DraftArticleReaderOptions,
  type ReadContext,
} from "@/src/pipeline/draft/articles/draft-reader";
export { guardHtml, READABILITY_LIMITS, type HtmlLimits } from "@/src/pipeline/draft/articles/html-guard";
export type { ParseJob } from "@/src/pipeline/draft/articles/html-text";
export {
  createWorkerParser,
  defaultHtmlParser,
  parseInThisThread,
  WORKER_HEAP_MB,
  type HtmlParser,
} from "@/src/pipeline/draft/articles/html-worker";
export {
  DEFAULT_TIMEOUTS,
  MAX_TEXT_CHARS,
  readArticle,
  type ArticleAttempt,
  type ArticleRead,
  type MethodTimeouts,
  type ReadArticleOptions,
} from "@/src/pipeline/draft/articles/read-article";
export {
  DEFAULT_DEADLINE_MS,
  readArticles,
  toArticleText,
  type ReadArticlesOptions,
  type ReadArticlesResult,
  type StoryArticleRead,
} from "@/src/pipeline/draft/articles/read-articles";
export { READER_USER_AGENT, type ArticleMethod, type ArticleStatus } from "@/src/pipeline/draft/articles/types";
