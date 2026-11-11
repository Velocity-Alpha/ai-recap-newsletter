import { assertPublicUrl, RefusedUrlError } from "@/src/pipeline/draft/articles/address-guard";
import { defaultHtmlParser, type HtmlParser } from "@/src/pipeline/draft/articles/html-worker";
import type { FetchLike, HostLimiter } from "@/src/pipeline/draft/articles/http";
import { readWithJina } from "@/src/pipeline/draft/articles/jina";
import { checkArticleText, type ArticleStatus, type NotReadStatus } from "@/src/pipeline/draft/articles/quality";
import { readWithReadability } from "@/src/pipeline/draft/articles/readability";
import { matchSiteAdapter } from "@/src/pipeline/draft/articles/site-adapters";
import { MethodError, type ArticleMethod, type MethodContext, type MethodText } from "@/src/pipeline/draft/articles/types";

/**
 * Reads one article with the #115 order: a site adapter when the host has one, then the page with Readability,
 * then Jina Reader. The first text that passes the quality check wins. When none does, the article is unread, and
 * its status is the strongest reason seen: paywalled, then blocked, then failed.
 * A method's limits count its work only (#170). Its network part runs from its first request's host slot to the
 * body; its text part from the text job's worker slot to the text. Waiting for a slot, behind other stories on the
 * same host or other pages' text jobs, uses up neither: only the read step's deadline limits it.
 * A link the address guard refuses, at any hop, stops the chain: Jina is not asked either.
 */

/** The network part's limit for each kind of method, and the text part's limit for all of them. */
export interface MethodTimeouts {
  adapter: number;
  fetch: number;
  jina: number;
  text: number;
}

export const DEFAULT_TIMEOUTS: MethodTimeouts = { adapter: 20_000, fetch: 20_000, jina: 30_000, text: 20_000 };

/** Text beyond this is not kept (full papers run to ~87,000 characters; the writer uses the first 20,000). */
export const MAX_TEXT_CHARS = 50_000;

export interface ArticleAttempt {
  method: ArticleMethod;
  ms: number;
  /** Of `ms`, the time spent waiting for a host slot and a text worker slot. Missing on reads saved before #170. */
  waitMs?: number;
  /** Of `ms`, the time of the text part (worker slot to text). Missing when no text job started. */
  textMs?: number;
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
  /** The text work. Defaults to the text worker when it can start (the Netlify function), this thread otherwise. */
  parse?: HtmlParser;
  jinaApiKey?: string;
  githubToken?: string;
}

type MethodPart = "network" | "text";

class MethodTimeout extends Error {
  constructor(part: MethodPart, ms: number) {
    super(`${part === "network" ? "Network" : "Text"} part timed out after ${ms / 1000} s.`);
    this.name = "MethodTimeout";
  }
}

/**
 * One method's clocks: the network and text limits, and the attempt's timings. Each part's limit starts when the
 * part gets its slot; the time before that is waiting.
 */
function methodClock(now: () => number, limits: Record<MethodPart, number>, abort: (reason: MethodTimeout) => void) {
  const started = now();
  let networkStarted: number | null = null;
  let textAsked: number | null = null;
  let textStarted: number | null = null;
  let textEnded: number | null = null;
  let networkTimer: ReturnType<typeof setTimeout> | undefined;
  let textTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    /** A request got its host slot. The network limit starts at the first. */
    startNetwork() {
      if (networkStarted !== null || textAsked !== null) return;
      networkStarted = now();
      networkTimer = setTimeout(() => abort(new MethodTimeout("network", limits.network)), limits.network);
    },
    /** The body is in and the text job is queued: the network part is over. */
    askText() {
      clearTimeout(networkTimer);
      textAsked ??= now();
    },
    /** The text job got its worker slot. */
    startText() {
      if (textStarted !== null) return;
      textStarted = now();
      textTimer = setTimeout(() => abort(new MethodTimeout("text", limits.text)), limits.text);
    },
    endText() {
      clearTimeout(textTimer);
      if (textStarted !== null) textEnded ??= now();
    },
    stop() {
      clearTimeout(networkTimer);
      clearTimeout(textTimer);
    },
    timings(): { ms: number; waitMs: number; textMs?: number } {
      const end = now();
      const hostWait = (networkStarted ?? textAsked ?? end) - started;
      const workerWait = textAsked === null ? 0 : (textStarted ?? end) - textAsked;
      const textMs = textStarted === null ? undefined : (textEnded ?? end) - textStarted;
      return { ms: end - started, waitMs: hostWait + workerWait, ...(textMs === undefined ? {} : { textMs }) };
    },
  };
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
  const parse = options.parse ?? defaultHtmlParser();
  for (const step of stepsFor(url, timeouts)) {
    if (options.signal?.aborted) break;

    let method = step.method;
    const controller = new AbortController();
    const clock = methodClock(now, { network: step.timeoutMs, text: timeouts.text }, (reason) => controller.abort(reason));
    // With no limiter there is no slot to wait for, so the clock starts now.
    if (!options.limiter) clock.startNetwork();
    const onDeadline = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onDeadline, { once: true });
    const context: MethodContext = {
      fetch: options.fetch,
      signal: controller.signal,
      parse: async (job, signal) => {
        clock.askText();
        try {
          return await parse(job, signal, () => clock.startText());
        } finally {
          clock.endText();
        }
      },
      limiter: options.limiter,
      onStart: () => clock.startNetwork(),
      readingAs: (other) => {
        method = other;
      },
      jinaApiKey: options.jinaApiKey,
      githubToken: options.githubToken,
    };
    try {
      // The race stops a method that ignores its abort signal.
      const result = await Promise.race([step.run(context), rejectOnAbort(controller.signal)]);
      const verdict = checkArticleText(result.text, result.httpStatus);
      const attempt = { method, ...clock.timings(), chars: result.text.length, httpStatus: result.httpStatus };
      if (verdict.ok) {
        attempts.push({ ...attempt, outcome: "read" });
        return {
          url,
          status: "read",
          method,
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
      attempts.push({ method, ...clock.timings(), chars: 0, outcome, error: errorMessage(error) });
      // A redirect or DNS answer pointing at a private address: no other method should go there either.
      if (error instanceof RefusedUrlError) break;
    } finally {
      clock.stop();
      options.signal?.removeEventListener("abort", onDeadline);
    }
  }

  const status = attempts.reduce<NotReadStatus>(
    (worst, attempt) => (attempt.outcome !== "read" && STATUS_RANK[attempt.outcome] > STATUS_RANK[worst] ? attempt.outcome : worst),
    "failed",
  );
  return unread(status, attempts.map((attempt) => `${attempt.method}: ${attempt.error}`).join(" ") || "No method ran.");
}
