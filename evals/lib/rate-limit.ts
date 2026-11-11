/**
 * Keeps eval traffic under our OpenAI rate limits, retries rate limits, and falls back from flex to standard.
 * One limiter per model for the whole process, so every sweep, judge and shared work draws on the same budget.
 */

export interface RateLimits {
  requestsPerMinute: number;
  tokensPerMinute: number;
}

/** Our organization's limits, read from the API's x-ratelimit-limit-* response headers on 2026-11-11. */
export const RATE_LIMITS: Record<string, RateLimits> = {
  "gpt-6-luna": { requestsPerMinute: 10_000, tokensPerMinute: 10_000_000 },
  "gpt-6-sol": { requestsPerMinute: 10_000, tokensPerMinute: 4_000_000 },
  "gpt-6.1-terra": { requestsPerMinute: 10_000, tokensPerMinute: 4_000_000 },
  "gpt-6.1-sol": { requestsPerMinute: 10_000, tokensPerMinute: 4_000_000 },
};

/** For a model not in RATE_LIMITS: low, so an unknown model is not pushed into 429s. Add the model instead. */
const UNKNOWN_MODEL_LIMITS: RateLimits = { requestsPerMinute: 1_000, tokensPerMinute: 1_000_000 };

/** The share of each limit evals may use (EVAL_RATE_SHARE), leaving room for production jobs. */
const DEFAULT_RATE_SHARE = 0.8;

/** The limits of a model, found by its name or the longest name it starts with (dated snapshots). */
export function rateLimitsFor(model: string): { model: string; limits: RateLimits } {
  const known = Object.keys(RATE_LIMITS)
    .filter((name) => model === name || model.startsWith(`${name}-`))
    .sort((a, b) => b.length - a.length)[0];
  return known ? { model: known, limits: RATE_LIMITS[known] } : { model, limits: UNKNOWN_MODEL_LIMITS };
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const REAL_CLOCK: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Two token buckets, requests and tokens, each holding one minute's limit and refilling evenly. A request takes
 * its estimated tokens before it is sent; `settle` corrects them from its usage, so the budget can go below zero.
 */
export class RateLimiter {
  private requests: number;
  private tokens: number;
  private last: number;

  constructor(
    readonly limits: RateLimits,
    private readonly clock: Clock = REAL_CLOCK
  ) {
    this.requests = limits.requestsPerMinute;
    this.tokens = limits.tokensPerMinute;
    this.last = clock.now();
  }

  private refill() {
    const now = this.clock.now();
    const minutes = (now - this.last) / 60_000;
    this.last = now;
    this.requests = Math.min(this.limits.requestsPerMinute, this.requests + minutes * this.limits.requestsPerMinute);
    this.tokens = Math.min(this.limits.tokensPerMinute, this.tokens + minutes * this.limits.tokensPerMinute);
  }

  /** Waits until one request and `estimate` tokens (at most a minute's worth) are free, and takes them. */
  async acquire(estimate: number): Promise<{ waitedMs: number; tokens: number }> {
    const tokens = Math.min(Math.max(0, estimate), this.limits.tokensPerMinute);
    const started = this.clock.now();
    for (;;) {
      this.refill();
      if (this.requests >= 1 && this.tokens >= tokens) {
        this.requests -= 1;
        this.tokens -= tokens;
        return { waitedMs: this.clock.now() - started, tokens };
      }
      const requestWait = ((1 - this.requests) / this.limits.requestsPerMinute) * 60_000;
      const tokenWait = ((tokens - this.tokens) / this.limits.tokensPerMinute) * 60_000;
      await this.clock.sleep(Math.max(1, Math.ceil(Math.max(requestWait, tokenWait))));
    }
  }

  /** Corrects the tokens taken for a request by what it used. */
  settle(taken: number, used: number): void {
    this.tokens -= used - taken;
  }
}

const limiters = new Map<string, RateLimiter>();

function rateShare(env: Record<string, string | undefined>): number {
  const raw = env.EVAL_RATE_SHARE?.trim();
  if (!raw) return DEFAULT_RATE_SHARE;
  const share = Number(raw);
  if (!(share > 0 && share <= 1)) throw new Error(`EVAL_RATE_SHARE must be above 0 and at most 1, not "${raw}".`);
  return share;
}

/** The process-wide limiter of a model, at EVAL_RATE_SHARE of its limits. */
export function limiterFor(model: string, env: Record<string, string | undefined> = process.env): RateLimiter {
  const { model: key, limits } = rateLimitsFor(model);
  let limiter = limiters.get(key);
  if (!limiter) {
    const share = rateShare(env);
    limiter = new RateLimiter({
      requestsPerMinute: Math.floor(limits.requestsPerMinute * share),
      tokensPerMinute: Math.floor(limits.tokensPerMinute * share),
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

/** Room for an answer whose request sets no max_output_tokens: reasoning tokens count as output. */
const OUTPUT_ESTIMATE = 4_000;

/** The tokens a request may use, from its size (about four characters a token) and its output cap. */
export function estimateTokens(request: Record<string, unknown>): number {
  const output = typeof request.max_output_tokens === "number" ? request.max_output_tokens : OUTPUT_ESTIMATE;
  return Math.ceil(JSON.stringify(request).length / 4) + output;
}

/** The tokens an answer used, or null when it has no usage. */
export function usedTokens(usage: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined): number | null {
  if (!usage) return null;
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
}

/** The wait a 429 answer asks for, from retry-after-ms or retry-after (seconds or a date). */
export function retryAfterMs(headers: Headers | Record<string, string | undefined> | null | undefined): number | null {
  if (!headers) return null;
  const read = (name: string) => (headers instanceof Headers ? headers.get(name) : headers[name]) ?? null;
  const ms = Number(read("retry-after-ms"));
  if (read("retry-after-ms") !== null && Number.isFinite(ms) && ms >= 0) return ms;
  const raw = read("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** Exponential backoff with jitter: 1 s, 2 s, 4 s ... (each between half and all of that), at most a minute. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const full = Math.min(60_000, 1000 * 2 ** attempt);
  return Math.round(full * (0.5 + random() / 2));
}

/** What a 429 means: a spent quota (do not retry), flex capacity (back off, then standard), or a rate limit. */
export type TooManyKind = "quota" | "flex-capacity" | "rate-limit";

export function kindOfTooMany(error: { code?: string | null; type?: string | null; message?: string | null }): TooManyKind {
  if (error.code === "insufficient_quota" || error.type === "insufficient_quota") return "quota";
  const text = `${error.code ?? ""} ${error.type ?? ""} ${error.message ?? ""}`;
  if (/resource.?unavailable/i.test(text)) return "flex-capacity";
  return "rate-limit";
}

/** One try: the answer, or a 429 with what it said. `fail` gives up with it (throws, or returns the 429 answer). */
export type Sent<R> =
  | { ok: R }
  | {
      tooMany: { error: { code?: string | null; type?: string | null; message?: string | null }; retryAfterMs: number | null };
      fail: () => R;
    };

const RATE_LIMIT_TRIES = 8;
const FLEX_TRIES = 3;

export interface GuardOptions<R> {
  /** The JSON body, for the model, its size and its tier. Null for a request with no body (polling a response). */
  request: Record<string, unknown> | null;
  send: (request: Record<string, unknown> | null) => Promise<Sent<R>>;
  /** The tokens the answer used (null: unknown, keep the estimate), and its model when the request had none. */
  used: (result: R) => { tokens: number | null; model?: string };
  /** Time spent waiting, not calling: limiter waits, rate-limited tries and backoff. Not latency. */
  onWait?: (ms: number) => void;
  limiterFor?: (model: string) => RateLimiter;
  clock?: Clock;
  random?: () => number;
}

/**
 * Sends a request under its model's limiter. A rate-limit 429 is retried after the wait it asks for (or a backoff),
 * so it never counts as a model error. A flex-capacity 429 backs off FLEX_TRIES times, then the request goes on
 * the standard tier (no service_tier). A spent quota is not retried.
 */
export async function guarded<R>(options: GuardOptions<R>): Promise<R> {
  const clock = options.clock ?? REAL_CLOCK;
  const random = options.random ?? Math.random;
  const limiterOf = options.limiterFor ?? ((model: string) => limiterFor(model));
  const wait = (ms: number) => options.onWait?.(ms);
  let request = options.request;
  let rateTries = 0;
  let flexTries = 0;
  for (;;) {
    const model = typeof request?.model === "string" ? request.model : null;
    const limiter = model ? limiterOf(model) : null;
    const taken = limiter && request ? await limiter.acquire(estimateTokens(request)) : { waitedMs: 0, tokens: 0 };
    wait(taken.waitedMs);
    const started = clock.now();
    const sent = await options.send(request);
    if ("ok" in sent) {
      const used = options.used(sent.ok);
      const owner = limiter ?? (used.model ? limiterOf(used.model) : null);
      owner?.settle(taken.tokens, used.tokens ?? taken.tokens);
      return sent.ok;
    }
    limiter?.settle(taken.tokens, 0);
    const kind = kindOfTooMany(sent.tooMany.error);
    if (kind === "quota") return sent.fail();
    wait(clock.now() - started);
    if (kind === "flex-capacity" && request?.service_tier === "flex") {
      if (flexTries < FLEX_TRIES) {
        const ms = backoffMs(flexTries++, random);
        await clock.sleep(ms);
        wait(ms);
      } else {
        const standard = { ...request };
        delete standard.service_tier;
        request = standard;
      }
      continue;
    }
    if (rateTries >= RATE_LIMIT_TRIES) return sent.fail();
    const ms = sent.tooMany.retryAfterMs ?? backoffMs(rateTries, random);
    rateTries += 1;
    await clock.sleep(ms);
    wait(ms);
  }
}
