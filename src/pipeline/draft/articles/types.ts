import type { FetchLike, HostLimiter } from "@/src/pipeline/draft/articles/http";
import type { NotReadStatus } from "@/src/pipeline/draft/articles/quality";
import type { ParseJob } from "@/src/pipeline/draft/articles/text-job";

export type { ArticleStatus, NotReadStatus } from "@/src/pipeline/draft/articles/quality";

/**
 * How an article was read: a site adapter (arxiv, github, huggingface), the page itself (fetch), the page's link
 * answered with a PDF (pdf), or Jina Reader.
 */
export type ArticleMethod = "arxiv" | "github" | "huggingface" | "fetch" | "pdf" | "jina";

/** Names the site, so publishers can see who reads them. No personal contact details. */
export const READER_USER_AGENT = "AIRecapReader/1.0 (+https://airecap.news)";

/** #115: sec.gov sent 14 MB and liquid.ai 8.6 MB of HTML; past this, fall through to Jina. */
export const PAGE_MAX_BYTES = 5_000_000;
/** arXiv HTML papers with a lot of math run to a few MB. */
export const ADAPTER_MAX_BYTES = 10_000_000;
/** #170: PDFs (papers, court filings, government notices) run larger than HTML pages. */
export const PDF_MAX_BYTES = 20_000_000;

export interface MethodContext {
  fetch: FetchLike;
  /** Aborts at the method's timeout or the step's deadline. */
  signal: AbortSignal;
  /** Does one text job (HTML, Readability, Markdown, PDF): in a worker in the Netlify function. */
  parse: (job: ParseJob, signal: AbortSignal) => Promise<string>;
  limiter?: HostLimiter;
  /** Called when a request starts to wait for its host slot. The method's network limit pauses until `onStart`. */
  onWait?: () => void;
  /** Called when a request gets its host slot. The method's network limit runs from here. */
  onStart?: () => void;
  jinaApiKey?: string;
  githubToken?: string;
}

/** A method's text, before the quality check. */
export interface MethodText {
  text: string;
  /** The article's HTTP status (for Jina, the status Jina saw). */
  httpStatus: number;
  finalUrl: string;
  /** Set when the method read the link another way (the page method got a PDF): the attempt is stored under it. */
  method?: ArticleMethod;
}

/** A method that could not produce text at all, with how to count it. */
export class MethodError extends Error {
  constructor(
    readonly status: NotReadStatus,
    message: string,
    /** Set when the method was reading the link another way (a PDF over its cap): the attempt is stored under it. */
    readonly method?: ArticleMethod,
  ) {
    super(message);
    this.name = "MethodError";
  }
}
