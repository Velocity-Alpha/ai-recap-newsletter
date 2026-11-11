import OpenAI from "openai";

/** Token counts of one or more calls. `cached` is part of `input`; `reasoning` is part of `output`. */
export interface Usage {
  calls: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
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

export const NO_USAGE: Usage = { calls: 0, input: 0, cached: 0, output: 0, reasoning: 0 };

export function usageFrom(usage: ApiUsage | null | undefined): Usage | null {
  if (!usage) return null;
  return {
    calls: 1,
    input: usage.input_tokens ?? 0,
    cached: usage.input_tokens_details?.cached_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    reasoning: usage.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    calls: a.calls + b.calls,
    input: a.input + b.input,
    cached: a.cached + b.cached,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
  };
}

export function costUsd(usage: Usage, price: Price): number {
  return ((usage.input - usage.cached) * price.input + usage.cached * price.cached + usage.output * price.output) / 1_000_000;
}

/** Adds up the usage of every call made with one config. */
export class UsageRecorder {
  private sum: Usage = NO_USAGE;

  record(usage: ApiUsage | null | undefined): void {
    const one = usageFrom(usage);
    if (one) this.sum = addUsage(this.sum, one);
  }

  total(): Usage {
    return this.sum;
  }
}

/**
 * An OpenAI client for the Responses API that records the usage of each answer. Pass it as the `client` of a
 * call site: its type fits each site's own client interface. A background response has usage only once it is done,
 * so polling it records the usage once.
 */
export interface RecordingClient {
  responses: {
    create(request: never, options?: never): Promise<OpenAI.Responses.Response>;
    retrieve(responseId: string): Promise<OpenAI.Responses.Response>;
  };
}

export function recordingClient(recorder: UsageRecorder, apiKey = process.env.OPENAI_API_KEY): RecordingClient {
  let openai: OpenAI | null = null;
  // Made on first use, so an eval that never calls the Responses API needs no key.
  const api = () => (openai ??= new OpenAI({ apiKey, timeout: 600_000, maxRetries: 2 }));
  return {
    responses: {
      async create(request, options) {
        const response = (await api().responses.create(request, options)) as OpenAI.Responses.Response;
        recorder.record(response.usage);
        return response;
      },
      async retrieve(responseId) {
        const response = await api().responses.retrieve(responseId);
        if (response.status === "completed" || response.status === "incomplete" || response.status === "failed") {
          recorder.record(response.usage);
        }
        return response;
      },
    },
  };
}

/** A `fetch` that records the `usage` of each JSON answer, for call sites that use fetch (the Decisions API). */
export function recordingFetch(recorder: UsageRecorder, inner: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await inner(input, init);
    if (response.ok) {
      const body = (await response.clone().json().catch(() => null)) as { usage?: ApiUsage } | null;
      recorder.record(body?.usage);
    }
    return response;
  };
}
