import OpenAI from "openai";

import { guarded, retryAfterMs, usedTokens, type GuardOptions, type Sent } from "@/evals/lib/rate-limit";

/**
 * Token counts and tool calls of one or more model calls. `cached` is part of `input`; `reasoning` is part of
 * `output`. `webSearches` counts the `web_search_call` items of the answers.
 */
export interface Usage {
  calls: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  webSearches: number;
  /** The part of `input`, `cached` and `output` from answers on the flex tier, which costs FLEX_DISCOUNT less. */
  flex?: { input: number; cached: number; output: number };
}

/** US dollars per 1M tokens. */
export interface Price {
  input: number;
  cached: number;
  output: number;
}

/**
 * The tier of a request. The call under test always runs on "standard": its latency is a metric and its timeouts
 * mirror production. The judge and shared work run on "flex" by default (EVAL_JUDGE_TIER): half price, slower.
 */
export type ServiceTier = "standard" | "flex";

/** Flex costs half of standard, for every model (OpenAI pricing page, read on 2026-11-11). */
export const FLEX_DISCOUNT = 0.5;

/** Flex answers are slower, so a flex request gets 15 minutes. */
export const FLEX_TIMEOUT_MS = 15 * 60_000;

/**
 * Standard text prices from OpenAI's model pages (https://developers.openai.com/api/docs/models/<model>), read on
 * 2026-11-10 (gpt-6-luna, gpt-6-sol) and 2026-11-11 (gpt-6.1-terra, gpt-6.1-sol). Flex is FLEX_DISCOUNT off.
 * Add a model here before you eval it, or its cost shows as unknown.
 */
export const PRICES: Record<string, Price> = {
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-6-sol": { input: 2, cached: 0.2, output: 10 },
  "gpt-6.1-terra": { input: 1, cached: 0.05, output: 5 },
  "gpt-6.1-sol": { input: 2, cached: 0.1, output: 10 },
};

/**
 * The web search tool's fee: $10.00 per 1,000 calls, on top of its content tokens (they are in the answer's input
 * tokens). OpenAI pricing page, "Web search", read on 2026-11-10: https://developers.openai.com/api/docs/pricing
 */
export const WEB_SEARCH_USD_PER_CALL = 0.01;

export function priceOf(model: string): Price | null {
  return PRICES[model] ?? null;
}

/** The `usage` object of a Responses API (or Decisions API) answer. */
export interface ApiUsage {
  input_tokens?: number | null;
  input_tokens_details?: { cached_tokens?: number | null } | null;
  output_tokens?: number | null;
  output_tokens_details?: { reasoning_tokens?: number | null } | null;
}

export const NO_USAGE: Usage = { calls: 0, input: 0, cached: 0, output: 0, reasoning: 0, webSearches: 0 };

export function usageFrom(usage: ApiUsage | null | undefined, webSearches = 0): Usage | null {
  if (!usage) return null;
  return {
    calls: 1,
    input: usage.input_tokens ?? 0,
    cached: usage.input_tokens_details?.cached_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    reasoning: usage.output_tokens_details?.reasoning_tokens ?? 0,
    webSearches,
  };
}

/** The web search calls in an answer's output. */
export function webSearchCalls(response: { output?: Array<{ type?: string }> | null }): number {
  return (response.output ?? []).filter((item) => item.type === "web_search_call").length;
}

export function addUsage(a: Usage, b: Usage): Usage {
  const flex =
    a.flex || b.flex
      ? {
          input: (a.flex?.input ?? 0) + (b.flex?.input ?? 0),
          cached: (a.flex?.cached ?? 0) + (b.flex?.cached ?? 0),
          output: (a.flex?.output ?? 0) + (b.flex?.output ?? 0),
        }
      : undefined;
  return {
    calls: a.calls + b.calls,
    input: a.input + b.input,
    cached: a.cached + b.cached,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    webSearches: a.webSearches + b.webSearches,
    ...(flex ? { flex } : {}),
  };
}

function tokenUsd(tokens: { input: number; cached: number; output: number }, price: Price): number {
  return ((tokens.input - tokens.cached) * price.input + tokens.cached * price.cached + tokens.output * price.output) / 1_000_000;
}

/** Tokens at the model's price (flex tokens FLEX_DISCOUNT off), plus the per-call tool fees. */
export function costUsd(usage: Usage, price: Price): number {
  const flexOff = usage.flex ? tokenUsd(usage.flex, price) * FLEX_DISCOUNT : 0;
  return tokenUsd(usage, price) - flexOff + usage.webSearches * WEB_SEARCH_USD_PER_CALL;
}

/** Adds up the usage of calls, and keeps the time of each call and the answers it saw. */
export class UsageRecorder {
  private sum: Usage = NO_USAGE;
  /** Milliseconds of each call, failed calls too, without the time spent waiting (see `waitMs`). */
  readonly callMs: number[] = [];
  /** The Responses API answers, in order. */
  readonly responses: OpenAI.Responses.Response[] = [];
  /** Milliseconds spent waiting on rate limits, rate-limited tries and backoff: not model time, so not latency. */
  waitMs = 0;

  /** `serviceTier` is the tier the answer reports ("flex", "default", ...): flex tokens are priced apart. */
  record(usage: ApiUsage | null | undefined, extra: { webSearches?: number; ms?: number; serviceTier?: string | null } = {}): void {
    const one = usageFrom(usage, extra.webSearches ?? 0);
    if (one) {
      const flex = extra.serviceTier === "flex" ? { flex: { input: one.input, cached: one.cached, output: one.output } } : {};
      this.sum = addUsage(this.sum, { ...one, ...flex });
    }
    if (extra.ms !== undefined) this.callMs.push(Math.max(0, Math.round(extra.ms)));
  }

  wait(ms: number): void {
    this.waitMs += ms;
  }

  total(): Usage {
    return this.sum;
  }
}

/**
 * An OpenAI client for the Responses API that records each answer's usage, web searches and time. Pass it as the
 * `client` of a call site: its type fits each site's own client interface. A background response has usage only
 * once it is done, so polling it records the usage once.
 */
export interface RecordingClient {
  responses: {
    create(request: never, options?: unknown): Promise<OpenAI.Responses.Response>;
    retrieve(responseId: string): Promise<OpenAI.Responses.Response>;
  };
}

const DONE = new Set(["completed", "incomplete", "failed", "cancelled"]);

/** The part of the OpenAI client's `responses` that a recording client calls. */
export interface ResponsesApi {
  create(request: never, options?: never): Promise<unknown>;
  retrieve(responseId: string): Promise<OpenAI.Responses.Response>;
}

/** For tests: the limiter, clock and randomness of the rate-limit guard (evals/lib/rate-limit.ts). */
export type Guard = Pick<GuardOptions<unknown>, "limiterFor" | "clock" | "random">;

export interface RecordingClientOptions {
  /**
   * "standard" for the call under test, always: any `service_tier` of the request is removed. "flex" for the judge
   * and shared work: the request gets `service_tier: "flex"` and FLEX_TIMEOUT_MS, and goes on standard when flex
   * has no capacity.
   */
  tier: ServiceTier;
  /**
   * Drop the request's `reasoning` field, so the API's own default effort applies. Every call site sets an effort,
   * so this is the only way an eval can measure the API default (the `default` word in EVAL_EFFORTS).
   */
  sendNoEffort?: boolean;
  /** For tests. Defaults to the OpenAI client, made on first use so an eval that never calls the API needs no key. */
  api?: () => ResponsesApi;
  guard?: Guard;
}

/**
 * A fetch for the OpenAI client that marks each 429 answer `x-should-retry: false`, so the client throws it at
 * once and the rate-limit guard retries it, outside the call's timeout and timing. Other errors keep the client's
 * own retries, as in production.
 */
export function noRetryOn429(inner: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await inner(input, init);
    if (response.status !== 429) return response;
    const headers = new Headers(response.headers);
    headers.set("x-should-retry", "false");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

type ErrorFields = { code?: string | null; type?: string | null; message?: string | null };

/** The fields of an OpenAI error that tell one 429 from another. */
function errorFields(error: unknown): ErrorFields {
  const fields = error as ErrorFields & { error?: ErrorFields };
  return { code: fields.code ?? fields.error?.code, type: fields.type ?? fields.error?.type, message: fields.message };
}

/** Calls `work`; a thrown 429 becomes a `Sent` the guard can retry. */
async function sendOrTooMany<R>(work: () => Promise<R>): Promise<Sent<R>> {
  try {
    return { ok: await work() };
  } catch (error) {
    if ((error as { status?: number }).status !== 429) throw error;
    return {
      tooMany: { error: errorFields(error), retryAfterMs: retryAfterMs((error as { headers?: Headers }).headers) },
      fail: () => {
        throw error;
      },
    };
  }
}

const createDone = (response: OpenAI.Responses.Response) => !response.status || DONE.has(response.status);
const retrieveDone = (response: OpenAI.Responses.Response) => DONE.has(response.status ?? "");

/** The tokens an answer used, for the limiter: none yet for a background answer still running. */
const tokensOf = (isDone: (response: OpenAI.Responses.Response) => boolean) => (response: OpenAI.Responses.Response) => ({
  tokens: isDone(response) ? usedTokens(response.usage) : 0,
  model: response.model,
});

export function recordingClient(recorder: UsageRecorder, options: RecordingClientOptions): RecordingClient {
  let openai: OpenAI | null = null;
  const api =
    options.api ??
    (() =>
      (openai ??= new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: options.tier === "flex" ? FLEX_TIMEOUT_MS : 600_000,
        maxRetries: 2,
        fetch: noRetryOn429(),
      })).responses);
  const now = options.guard?.clock?.now ?? (() => performance.now());
  const guard = { ...options.guard, onWait: (ms: number) => recorder.wait(ms) };
  const prepare = (request: Record<string, unknown>) => {
    const body = { ...request };
    if (options.sendNoEffort) delete body.reasoning;
    // The call under test stays on the standard tier, always; the judge and shared work go on flex.
    if (options.tier === "standard") delete body.service_tier;
    else body.service_tier = "flex";
    return body;
  };

  /** Times one call, without its waits, and records its answer once it is done. */
  async function timed(work: () => Promise<OpenAI.Responses.Response>, isDone: (response: OpenAI.Responses.Response) => boolean) {
    const started = now();
    const waitedBefore = recorder.waitMs;
    let response: OpenAI.Responses.Response | null = null;
    try {
      response = await work();
      return response;
    } finally {
      const ms = now() - started - (recorder.waitMs - waitedBefore);
      if (response && isDone(response)) {
        recorder.responses.push(response);
        recorder.record(response.usage, { webSearches: webSearchCalls(response), ms, serviceTier: response.service_tier });
      } else {
        recorder.record(null, { ms });
      }
    }
  }

  return {
    responses: {
      create: (request, requestOptions) => {
        const sendOptions = options.tier === "flex" ? { ...(requestOptions as object | undefined), timeout: FLEX_TIMEOUT_MS } : requestOptions;
        return timed(
          () =>
            guarded({
              ...guard,
              request: prepare(request as Record<string, unknown>),
              send: (body) => sendOrTooMany(async () => (await api().create(body as never, sendOptions as never)) as OpenAI.Responses.Response),
              used: tokensOf(createDone),
            }),
          createDone
        );
      },
      retrieve: (responseId) =>
        timed(
          () => guarded({ ...guard, request: null, send: () => sendOrTooMany(() => api().retrieve(responseId)), used: tokensOf(retrieveDone) }),
          retrieveDone
        ),
    },
  };
}

function jsonBody(init: RequestInit | undefined): Record<string, unknown> | null {
  if (typeof init?.body !== "string") return null;
  try {
    const parsed = JSON.parse(init.body) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * A `fetch` that records the `usage` and time of each JSON answer, for call sites that use fetch (the Decisions
 * API). It goes through the rate-limit guard too, so a 429 is retried, not an error.
 */
export function recordingFetch(recorder: UsageRecorder, inner: typeof fetch = fetch, guard: Guard = {}): typeof fetch {
  const now = guard.clock?.now ?? (() => performance.now());
  return async (input, init) => {
    const started = now();
    const waitedBefore = recorder.waitMs;
    const response = await guarded<Response>({
      ...guard,
      onWait: (ms) => recorder.wait(ms),
      request: jsonBody(init),
      send: async () => {
        const answer = await inner(input, init);
        if (answer.status !== 429) return { ok: answer };
        const body = (await answer.clone().json().catch(() => null)) as { error?: ErrorFields } | null;
        return { tooMany: { error: body?.error ?? {}, retryAfterMs: retryAfterMs(answer.headers) }, fail: () => answer };
      },
      used: () => ({ tokens: null }),
    });
    const body = response.ok ? ((await response.clone().json().catch(() => null)) as { usage?: ApiUsage } | null) : null;
    recorder.record(body?.usage, { ms: now() - started - (recorder.waitMs - waitedBefore) });
    return response;
  };
}
