import type { FetchLike, HostLimiter } from "@/src/pipeline/draft/articles/http";
import type { NotReadStatus } from "@/src/pipeline/draft/articles/quality";

export type { ArticleStatus, NotReadStatus } from "@/src/pipeline/draft/articles/quality";

/** How an article was read: a site adapter (arxiv, github, huggingface), the page itself (fetch), or Jina Reader. */
export type ArticleMethod = "arxiv" | "github" | "huggingface" | "fetch" | "jina";

/** Names the site, so publishers can see who reads them. No personal contact details. */
export const READER_USER_AGENT = "AIRecapReader/1.0 (+https://airecap.news)";

/** #115: sec.gov sent 14 MB and liquid.ai 8.6 MB of HTML; past this, fall through to Jina. */
export const PAGE_MAX_BYTES = 5_000_000;
/** arXiv HTML papers with a lot of math run to a few MB. */
export const ADAPTER_MAX_BYTES = 10_000_000;

export interface MethodContext {
  fetch: FetchLike;
  /** Aborts at the method's timeout or the step's deadline. */
  signal: AbortSignal;
  limiter?: HostLimiter;
  jinaApiKey?: string;
  githubToken?: string;
}

/** A method's text, before the quality check. */
export interface MethodText {
  text: string;
  /** The article's HTTP status (for Jina, the status Jina saw). */
  httpStatus: number;
  finalUrl: string;
}

/** A method that could not produce text at all, with how to count it. */
export class MethodError extends Error {
  constructor(
    readonly status: NotReadStatus,
    message: string,
  ) {
    super(message);
    this.name = "MethodError";
  }
}
