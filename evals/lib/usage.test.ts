import { describe, expect, it, vi } from "vitest";

import { costUsd, priceOf, recordingFetch, UsageRecorder, usageFrom } from "@/evals/lib/usage";

describe("usageFrom", () => {
  it("reads the Responses API usage, with cached and reasoning tokens", () => {
    expect(
      usageFrom({
        input_tokens: 1000,
        input_tokens_details: { cached_tokens: 400 },
        output_tokens: 300,
        output_tokens_details: { reasoning_tokens: 200 },
      })
    ).toEqual({ calls: 1, input: 1000, cached: 400, output: 300, reasoning: 200 });
  });

  it("is null for a response with no usage yet (a queued background response)", () => {
    expect(usageFrom(null)).toBeNull();
    expect(usageFrom(undefined)).toBeNull();
  });
});

describe("costUsd", () => {
  it("charges cached input at the cached price, and reasoning as output", () => {
    const usage = { calls: 1, input: 1_000_000, cached: 400_000, output: 1_000_000, reasoning: 600_000 };
    // 600k fresh x $0.10 + 400k cached x $0.01 + 1M out x $0.50
    expect(costUsd(usage, priceOf("gpt-6-luna")!)).toBeCloseTo(0.06 + 0.004 + 0.5, 10);
  });

  it("knows gpt-6-luna and gpt-6-sol, and no other model", () => {
    expect(priceOf("gpt-6-luna")).toEqual({ input: 0.1, cached: 0.01, output: 0.5 });
    expect(priceOf("gpt-6-sol")).toEqual({ input: 2, cached: 0.2, output: 10 });
    expect(priceOf("gpt-9-unknown")).toBeNull();
  });
});

describe("UsageRecorder", () => {
  it("adds up the usage it records", () => {
    const recorder = new UsageRecorder();
    recorder.record({ input_tokens: 10, output_tokens: 5 });
    recorder.record(null);
    recorder.record({ input_tokens: 20, input_tokens_details: { cached_tokens: 10 }, output_tokens: 1 });
    expect(recorder.total()).toEqual({ calls: 2, input: 30, cached: 10, output: 6, reasoning: 0 });
  });
});

describe("recordingFetch", () => {
  it("records the usage of a JSON answer and still returns the whole body", async () => {
    const recorder = new UsageRecorder();
    const body = { answers: [], usage: { input_tokens: 42, output_tokens: 0 } };
    const inner = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const response = await recordingFetch(recorder, inner as unknown as typeof fetch)("https://example.org", {});
    await expect(response.json()).resolves.toEqual(body);
    expect(recorder.total()).toMatchObject({ calls: 1, input: 42 });
  });
});
