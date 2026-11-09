import { assertPublicUrl, RefusedUrlError } from "@/src/pipeline/draft/articles/address-guard";
import type { FetchLike, HostLimiter } from "@/src/pipeline/draft/articles/http";
import { readWithJina } from "@/src/pipeline/draft/articles/jina";
import { checkArticleText, type ArticleStatus, type NotReadStatus } from "@/src/pipeline/draft/articles/quality";
import { readWithReadability } from "@/src/pipeline/draft/articles/readability";
import { matchSiteAdapter } from "@/src/pipeline/draft/articles/site-adapters";
import { MethodError, type ArticleMethod, type MethodContext, type MethodText } from "@/src/pipeline/draft/articles/types";

/**
 * Reads one article with the #115 order: a site adapter when the host has one (20 s), then the page with
 * Readability (12 s), then Jina Reader (30 s). The first text that passes the quality check wins. When none
 * does, the article is unread, and its status is the strongest reason seen: paywalled, then blocked, then failed.
 */

export interface MethodTimeouts {
  adapter: number;
  fetch: number;
  jina: number;
}

export const DEFAULT_TIMEOUTS: MethodTimeouts = { adapter: 20_000, fetch: 12_000, jina: 30_000 };

/** Text beyond this is not kept (full papers run to ~87,000 characters; the writer uses the first 20,000). */
export const MAX_TEXT_CHARS = 50_000;

export interface ArticleAttempt {
  method: ArticleMethod;
  ms: number;
  /** Characters of text the method returned. */
  chars: number;
  /** `read`, or how this method's text failed. */
  outcome: ArticleStatus;
  httpStatus?: number;
  error?: string;
}

export interface ArticleRead {
  /** The link that was read (the story's link, after any board edit). */
  url: string;
  status: ArticleStatus;
  method: ArticleMethod | null;
  /** The article text, cut to MAX_TEXT_CHARS. Null unless read. */
  text: string | null;
  finalUrl: string | null;
  /** The text's full length before the cut. */
  chars: number;
  ms: number;
  /** Why it was not read: each method's reason. Null when read. */
  error: string | null;
  attempts: ArticleAttempt[];
}

export interface ReadArticleOptions {
  fetch: FetchLike;
  /** Milliseconds clock, for timings. */
  now?: () => number;
  /** The read step's deadline. When it aborts, the running method stops and no other method starts. */
  signal?: AbortSignal;
  timeouts?: Partial<MethodTimeouts>;
  limiter?: HostLimiter;
  jinaApiKey?: string;
  githubToken?: string;
}

class MethodTimeout extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms / 1000} s.`);
    this.name = "MethodTimeout";
  }
}

const STATUS_RANK: Record<NotReadStatus, number> = { paywalled: 3, blocked: 2, failed: 1 };

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Step {
  method: ArticleMethod;
  timeoutMs: number;
  run: (context: MethodContext) => Promise<MethodText>;
}

function stepsFor(url: string, timeouts: MethodTimeouts): Step[] {
  const adapter = matchSiteAdapter(url);
  return [
    ...(adapter ? [{ method: adapter.method, timeoutMs: timeouts.adapter, run: (context: MethodContext) => adapter.read(context) }] : []),
    { method: "fetch", timeoutMs: timeouts.fetch, run: (context) => readWithReadability(url, context) },
    { method: "jina", timeoutMs: timeouts.jina, run: (context) => readWithJina(url, context) },
  ];
}

export async function readArticle(url: string, options: ReadArticleOptions): Promise<ArticleRead> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const attempts: ArticleAttempt[] = [];
  const unread = (status: NotReadStatus, error: string): ArticleRead => ({
    url,
    status,
    method: null,
    text: null,
    finalUrl: null,
    chars: 0,
    ms: now() - started,
    error,
    attempts,
  });

  try {
    assertPublicUrl(url);
  } catch (error) {
    if (error instanceof RefusedUrlError) return unread("failed", error.message);
    throw error;
  }

  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  for (const step of stepsFor(url, timeouts)) {
    if (options.signal?.aborted) break;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new MethodTimeout(step.timeoutMs)), step.timeoutMs);
    const onDeadline = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onDeadline, { once: true });
    const context: MethodContext = {
      fetch: options.fetch,
      signal: controller.signal,
      limiter: options.limiter,
      jinaApiKey: options.jinaApiKey,
      githubToken: options.githubToken,
    };
    const attemptStarted = now();
    try {
      // The race stops a method that ignores its abort signal.
      const result = await Promise.race([step.run(context), rejectOnAbort(controller.signal)]);
      const verdict = checkArticleText(result.text, result.httpStatus);
      const attempt = { method: step.method, ms: now() - attemptStarted, chars: result.text.length, httpStatus: result.httpStatus };
      if (verdict.ok) {
        attempts.push({ ...attempt, outcome: "read" });
        return {
          url,
          status: "read",
          method: step.method,
          text: result.text.slice(0, MAX_TEXT_CHARS),
          finalUrl: result.finalUrl,
          chars: result.text.length,
          ms: now() - started,
          error: null,
          attempts,
        };
      }
      attempts.push({ ...attempt, outcome: verdict.status, error: verdict.reason });
    } catch (error) {
      const outcome = error instanceof MethodError ? error.status : "failed";
      attempts.push({ method: step.method, ms: now() - attemptStarted, chars: 0, outcome, error: errorMessage(error) });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onDeadline);
    }
  }

  const status = attempts.reduce<NotReadStatus>(
    (worst, attempt) => (attempt.outcome !== "read" && STATUS_RANK[attempt.outcome] > STATUS_RANK[worst] ? attempt.outcome : worst),
    "failed",
  );
  return unread(status, attempts.map((attempt) => `${attempt.method}: ${attempt.error}`).join(" ") || "No method ran.");
}
