import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import {
  costUsd,
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

describe("priceOf", () => {
  it("knows gpt-6-luna and gpt-6-sol", () => {
    expect(priceOf("gpt-6-luna")).toEqual({ input: 0.1, cached: 0.01, output: 0.5 });
    expect(priceOf("gpt-6-sol")).toEqual({ input: 2, cached: 0.2, output: 10 });
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
});

function fakeApi() {
  const response = { id: "resp_1", status: "completed", output: [], usage: { input_tokens: 7, output_tokens: 3 } };
  return {
    create: vi.fn(async () => response as unknown as OpenAI.Responses.Response),
    retrieve: vi.fn(async () => response as unknown as OpenAI.Responses.Response),
  };
}

describe("recordingClient", () => {
  it("sends the request as the call site built it", async () => {
    const api = fakeApi();
    const client = recordingClient(new UsageRecorder(), { api: () => api });
    await client.responses.create({ model: "gpt-6-luna", reasoning: { effort: "low" }, input: "hi" } as never);
    expect(api.create).toHaveBeenCalledWith({ model: "gpt-6-luna", reasoning: { effort: "low" }, input: "hi" }, undefined);
  });

  it("drops the request's reasoning field when the run sends no effort, so the API default applies", async () => {
    const api = fakeApi();
    const client = recordingClient(new UsageRecorder(), { api: () => api, sendNoEffort: true });
    await client.responses.create({ model: "gpt-6-luna", reasoning: { effort: "low" }, input: "hi" } as never);
    expect(api.create).toHaveBeenCalledWith({ model: "gpt-6-luna", input: "hi" }, undefined);
  });

  it("records the usage and time of each answer", async () => {
    const recorder = new UsageRecorder();
    const client = recordingClient(recorder, { api: () => fakeApi() });
    await client.responses.create({ input: "hi" } as never);
    expect(recorder.total()).toMatchObject({ calls: 1, input: 7, output: 3 });
    expect(recorder.callMs).toHaveLength(1);
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
});
