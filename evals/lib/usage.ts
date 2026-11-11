import OpenAI from "openai";

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
}

/** US dollars per 1M tokens. */
export interface Price {
  input: number;
  cached: number;
  output: number;
}

/**
 * Standard text prices from OpenAI's model pages, read on 2026-11-10:
 * https://developers.openai.com/api/docs/models/gpt-6-luna and .../models/gpt-6-sol
 * Add a model here before you eval it, or its cost shows as unknown.
 */
export const PRICES: Record<string, Price> = {
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-6-sol": { input: 2, cached: 0.2, output: 10 },
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
  return {
    calls: a.calls + b.calls,
    input: a.input + b.input,
    cached: a.cached + b.cached,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    webSearches: a.webSearches + b.webSearches,
  };
}

/** Tokens at the model's price, plus the per-call tool fees. */
export function costUsd(usage: Usage, price: Price): number {
  const tokens = (usage.input - usage.cached) * price.input + usage.cached * price.cached + usage.output * price.output;
  return tokens / 1_000_000 + usage.webSearches * WEB_SEARCH_USD_PER_CALL;
}

/** Adds up the usage of calls, and keeps the time of each call and the answers it saw. */
export class UsageRecorder {
  private sum: Usage = NO_USAGE;
  /** Milliseconds of each HTTP call, failed calls too. */
  readonly callMs: number[] = [];
  /** The Responses API answers, in order. */
  readonly responses: OpenAI.Responses.Response[] = [];

  record(usage: ApiUsage | null | undefined, extra: { webSearches?: number; ms?: number } = {}): void {
    const one = usageFrom(usage, extra.webSearches ?? 0);
    if (one) this.sum = addUsage(this.sum, one);
    if (extra.ms !== undefined) this.callMs.push(Math.round(extra.ms));
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

export interface RecordingClientOptions {
  /**
   * Drop the request's `reasoning` field, so the API's own default effort applies. Every call site sets an effort,
   * so this is the only way an eval can measure the API default (the `default` word in EVAL_EFFORTS).
   */
  sendNoEffort?: boolean;
  /** For tests. Defaults to the OpenAI client, made on first use so an eval that never calls the API needs no key. */
  api?: () => ResponsesApi;
}

export function recordingClient(recorder: UsageRecorder, options: RecordingClientOptions = {}): RecordingClient {
  let openai: OpenAI | null = null;
  const api =
    options.api ?? (() => (openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 600_000, maxRetries: 2 })).responses);
  const prepare = (request: Record<string, unknown>) => {
    if (!options.sendNoEffort) return request;
    const rest = { ...request };
    delete rest.reasoning;
    return rest;
  };

  async function timed(work: () => Promise<OpenAI.Responses.Response>, recordUsage: (response: OpenAI.Responses.Response) => boolean) {
    const started = performance.now();
    let response: OpenAI.Responses.Response | null = null;
    try {
      response = await work();
      return response;
    } finally {
      const ms = performance.now() - started;
      if (response && recordUsage(response)) {
        recorder.responses.push(response);
        recorder.record(response.usage, { webSearches: webSearchCalls(response), ms });
      } else {
        recorder.record(null, { ms });
      }
    }
  }

  return {
    responses: {
      create: (request, requestOptions) =>
        timed(
          async () => (await api().create(prepare(request) as never, requestOptions as never)) as OpenAI.Responses.Response,
          (response) => !response.status || DONE.has(response.status)
        ),
      retrieve: (responseId) =>
        timed(
          () => api().retrieve(responseId),
          (response) => DONE.has(response.status ?? "")
        ),
    },
  };
}

/** A `fetch` that records the `usage` and time of each JSON answer, for call sites that use fetch (the Decisions API). */
export function recordingFetch(recorder: UsageRecorder, inner: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const started = performance.now();
    const response = await inner(input, init);
    const body = response.ok ? ((await response.clone().json().catch(() => null)) as { usage?: ApiUsage } | null) : null;
    recorder.record(body?.usage, { ms: performance.now() - started });
    return response;
  };
}
