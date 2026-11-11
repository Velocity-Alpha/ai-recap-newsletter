import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { RateLimiter, type Clock } from "@/evals/lib/rate-limit";
import {
  costUsd,
  FLEX_TIMEOUT_MS,
  noRetryOn429,
  priceOf,
  recordingClient,
  recordingFetch,
  UsageRecorder,
  usageFrom,
  WEB_SEARCH_USD_PER_CALL,
  webSearchCalls,
} from "@/evals/lib/usage";

describe("usageFrom", () => {
  it("reads the Responses API usage, with cached and reasoning tokens", () => {
    expect(
      usageFrom({
        input_tokens: 1000,
        input_tokens_details: { cached_tokens: 400 },
        output_tokens: 300,
        output_tokens_details: { reasoning_tokens: 200 },
      })
    ).toEqual({ calls: 1, input: 1000, cached: 400, output: 300, reasoning: 200, webSearches: 0 });
  });

  it("is null for a response with no usage yet (a queued background response)", () => {
    expect(usageFrom(null)).toBeNull();
    expect(usageFrom(undefined)).toBeNull();
  });
});

describe("webSearchCalls", () => {
  it("counts the web_search_call items of an answer", () => {
    const output = [{ type: "web_search_call" }, { type: "reasoning" }, { type: "web_search_call" }, { type: "message" }];
    expect(webSearchCalls({ output })).toBe(2);
  });

  it("is 0 for an answer with no output", () => {
    expect(webSearchCalls({})).toBe(0);
  });
});

describe("costUsd", () => {
  it("charges cached input at the cached price", () => {
    const usage = { calls: 1, input: 1_000_000, cached: 400_000, output: 0, reasoning: 0, webSearches: 0 };
    // 600k fresh x $0.10 + 400k cached x $0.01
    expect(costUsd(usage, priceOf("gpt-6-luna")!)).toBeCloseTo(0.06 + 0.004, 10);
  });

  it("charges reasoning tokens as the output they are part of", () => {
    const usage = { calls: 1, input: 0, cached: 0, output: 1_000_000, reasoning: 600_000, webSearches: 0 };
    expect(costUsd(usage, priceOf("gpt-6-luna")!)).toBeCloseTo(0.5, 10);
  });

  it("adds the web search fee for each search call", () => {
    const usage = { calls: 1, input: 0, cached: 0, output: 0, reasoning: 0, webSearches: 3 };
    expect(WEB_SEARCH_USD_PER_CALL).toBe(0.01);
    expect(costUsd(usage, priceOf("gpt-6-luna")!)).toBeCloseTo(0.03, 10);
  });
});

describe("costUsd on the flex tier", () => {
  it("charges the tokens of flex answers at half price", () => {
    const flex = { input: 1_000_000, cached: 0, output: 1_000_000 };
    const usage = { calls: 1, input: 1_000_000, cached: 0, output: 1_000_000, reasoning: 0, webSearches: 0, flex };
    // standard: $1 in + $5 out; flex is half of that
    expect(costUsd(usage, priceOf("gpt-6.1-terra")!)).toBeCloseTo(3, 10);
  });
});

describe("priceOf", () => {
  it("knows the models we run and judge with", () => {
    expect(priceOf("gpt-6-luna")).toEqual({ input: 0.1, cached: 0.01, output: 0.5 });
    expect(priceOf("gpt-6-sol")).toEqual({ input: 2, cached: 0.2, output: 10 });
    expect(priceOf("gpt-6.1-terra")).toEqual({ input: 1, cached: 0.05, output: 5 });
    expect(priceOf("gpt-6.1-sol")).toEqual({ input: 2, cached: 0.1, output: 10 });
  });

  it("is null for any other model", () => {
    expect(priceOf("gpt-9-unknown")).toBeNull();
  });
});

describe("UsageRecorder", () => {
  it("adds up the usage it records", () => {
    const recorder = new UsageRecorder();
    recorder.record({ input_tokens: 10, output_tokens: 5 });
    recorder.record({ input_tokens: 20, input_tokens_details: { cached_tokens: 10 }, output_tokens: 1 }, { webSearches: 2 });
    expect(recorder.total()).toEqual({ calls: 2, input: 30, cached: 10, output: 6, reasoning: 0, webSearches: 2 });
  });

  it("keeps each call's time, also for a call with no usage", () => {
    const recorder = new UsageRecorder();
    recorder.record({ input_tokens: 10, output_tokens: 5 }, { ms: 100 });
    recorder.record(null, { ms: 50 });
    expect(recorder.callMs).toEqual([100, 50]);
  });

  it("keeps the tokens of answers on the flex tier apart, for their price", () => {
    const recorder = new UsageRecorder();
    recorder.record({ input_tokens: 10, output_tokens: 5 }, { serviceTier: "flex" });
    recorder.record({ input_tokens: 20, output_tokens: 1 }, { serviceTier: "default" });
    expect(recorder.total()).toMatchObject({ calls: 2, input: 30, output: 6, flex: { input: 10, cached: 0, output: 5 } });
  });

  it("adds up the time spent waiting", () => {
    const recorder = new UsageRecorder();
    recorder.wait(100);
    recorder.wait(50);
    expect(recorder.waitMs).toBe(150);
  });
});

function fakeApi(extra: Record<string, unknown> = {}) {
  const response = { id: "resp_1", status: "completed", output: [], usage: { input_tokens: 7, output_tokens: 3 }, ...extra };
  return {
    create: vi.fn<(...args: unknown[]) => Promise<OpenAI.Responses.Response>>(async () => response as unknown as OpenAI.Responses.Response),
    retrieve: vi.fn(async () => response as unknown as OpenAI.Responses.Response),
  };
}

/** A clock whose sleep moves time on at once, and a limiter that never waits, so retries take no real time. */
function fastGuard() {
  let time = 0;
  const clock: Clock = { now: () => time, sleep: async (ms) => void (time += ms) };
  const limiter = new RateLimiter({ requestsPerMinute: 1_000_000, tokensPerMinute: 1_000_000_000 }, clock);
  return { clock, limiterFor: () => limiter };
}

function rateLimitError(code = "rate_limit_exceeded") {
  return Object.assign(new Error(`429 ${code}`), { status: 429, code, headers: new Headers({ "retry-after-ms": "2000" }) });
}

describe("recordingClient", () => {
  it("sends the request as the call site built it", async () => {
    const api = fakeApi();
    const client = recordingClient(new UsageRecorder(), { tier: "standard", api: () => api, guard: fastGuard() });
    await client.responses.create({ model: "gpt-6-luna", reasoning: { effort: "low" }, input: "hi" } as never);
    expect(api.create).toHaveBeenCalledWith({ model: "gpt-6-luna", reasoning: { effort: "low" }, input: "hi" }, undefined);
  });

  it("drops the request's reasoning field when the run sends no effort, so the API default applies", async () => {
    const api = fakeApi();
    const client = recordingClient(new UsageRecorder(), { tier: "standard", api: () => api, sendNoEffort: true, guard: fastGuard() });
    await client.responses.create({ model: "gpt-6-luna", reasoning: { effort: "low" }, input: "hi" } as never);
    expect(api.create).toHaveBeenCalledWith({ model: "gpt-6-luna", input: "hi" }, undefined);
  });

  it("records the usage and time of each answer", async () => {
    const recorder = new UsageRecorder();
    const client = recordingClient(recorder, { tier: "standard", api: () => fakeApi(), guard: fastGuard() });
    await client.responses.create({ input: "hi" } as never);
    expect(recorder.total()).toMatchObject({ calls: 1, input: 7, output: 3 });
    expect(recorder.callMs).toHaveLength(1);
  });

  it("keeps the call under test on the standard tier, whatever the request says", async () => {
    const api = fakeApi();
    const client = recordingClient(new UsageRecorder(), { tier: "standard", api: () => api, guard: fastGuard() });
    await client.responses.create({ model: "gpt-6-luna", input: "hi", service_tier: "flex" } as never);
    expect(api.create.mock.calls[0][0]).not.toHaveProperty("service_tier");
  });

  it("sends judge calls on the flex tier, with a long timeout", async () => {
    const api = fakeApi();
    const client = recordingClient(new UsageRecorder(), { tier: "flex", api: () => api, guard: fastGuard() });
    await client.responses.create({ model: "gpt-6.1-terra", input: "hi" } as never);
    expect(api.create).toHaveBeenCalledWith({ model: "gpt-6.1-terra", input: "hi", service_tier: "flex" }, { timeout: FLEX_TIMEOUT_MS });
  });

  it("prices an answer by the tier it reports", async () => {
    const recorder = new UsageRecorder();
    const client = recordingClient(recorder, { tier: "flex", api: () => fakeApi({ service_tier: "flex" }), guard: fastGuard() });
    await client.responses.create({ model: "gpt-6.1-terra", input: "hi" } as never);
    expect(recorder.total().flex).toEqual({ input: 7, cached: 0, output: 3 });
  });

  it("retries a rate limit, so it is not an error, and leaves the wait out of the call's time", async () => {
    const recorder = new UsageRecorder();
    const api = fakeApi();
    api.create.mockRejectedValueOnce(rateLimitError());
    const client = recordingClient(recorder, { tier: "standard", api: () => api, guard: fastGuard() });
    await client.responses.create({ model: "gpt-6-luna", input: "hi" } as never);
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(recorder.waitMs).toBeGreaterThanOrEqual(2000);
    expect(recorder.callMs[0]).toBeLessThan(1000);
  });

  it("does not retry a spent quota", async () => {
    const api = fakeApi();
    api.create.mockRejectedValueOnce(rateLimitError("insufficient_quota"));
    const client = recordingClient(new UsageRecorder(), { tier: "standard", api: () => api, guard: fastGuard() });
    await expect(client.responses.create({ model: "gpt-6-luna", input: "hi" } as never)).rejects.toThrow("insufficient_quota");
  });
});

describe("noRetryOn429", () => {
  it("tells the OpenAI client not to retry a 429 itself, so the recording client handles it", async () => {
    const inner = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "1" } }));
    const response = await noRetryOn429(inner as unknown as typeof fetch)("https://example.org", {});
    expect(response.headers.get("x-should-retry")).toBe("false");
    expect(response.headers.get("retry-after")).toBe("1");
  });

  it("leaves other answers as they are", async () => {
    const answer = new Response("{}", { status: 200 });
    const response = await noRetryOn429(vi.fn(async () => answer) as unknown as typeof fetch)("https://example.org", {});
    expect(response).toBe(answer);
  });
});

describe("recordingFetch", () => {
  it("still returns the whole body", async () => {
    const body = { answers: [], usage: { input_tokens: 42, output_tokens: 0 } };
    const inner = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const response = await recordingFetch(new UsageRecorder(), inner as unknown as typeof fetch)("https://example.org", {});
    await expect(response.json()).resolves.toEqual(body);
  });

  it("records the usage and time of a JSON answer", async () => {
    const recorder = new UsageRecorder();
    const body = { answers: [], usage: { input_tokens: 42, output_tokens: 0 } };
    const inner = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    await recordingFetch(recorder, inner as unknown as typeof fetch)("https://example.org", {});
    expect(recorder.total()).toMatchObject({ calls: 1, input: 42 });
    expect(recorder.callMs).toHaveLength(1);
  });

  it("retries a rate-limited answer, so it is not an error", async () => {
    const recorder = new UsageRecorder();
    const body = { answers: [], usage: { input_tokens: 42, output_tokens: 0 } };
    const inner = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), { status: 429, headers: { "retry-after-ms": "500" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
    const response = await recordingFetch(recorder, inner as unknown as typeof fetch, fastGuard())("https://example.org", {
      body: JSON.stringify({ model: "gpt-6-luna" }),
    });
    expect(response.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(recorder.waitMs).toBeGreaterThanOrEqual(500);
  });
});
