import { describe, expect, it, vi } from "vitest";

import {
  backoffMs,
  estimateTokens,
  guarded,
  kindOfTooMany,
  RateLimiter,
  rateLimitsFor,
  retryAfterMs,
  type Clock,
  type Sent,
} from "@/evals/lib/rate-limit";

/** A clock whose sleep moves time on at once, so tests do not wait. */
function fakeClock(): Clock & { slept: number[] } {
  let time = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => time,
    sleep: async (ms) => {
      slept.push(ms);
      time += ms;
    },
  };
}

describe("rateLimitsFor", () => {
  it("knows the limits of the models we run", () => {
    expect(rateLimitsFor("gpt-6-luna").limits).toEqual({ requestsPerMinute: 10_000, tokensPerMinute: 10_000_000 });
    expect(rateLimitsFor("gpt-6.1-terra").limits).toEqual({ requestsPerMinute: 10_000, tokensPerMinute: 4_000_000 });
  });

  it("finds a dated snapshot by its model's name", () => {
    expect(rateLimitsFor("gpt-6-luna-2026-10-01").model).toBe("gpt-6-luna");
  });

  it("falls back to a low limit for a model it does not know", () => {
    expect(rateLimitsFor("gpt-9").limits.tokensPerMinute).toBeLessThanOrEqual(1_000_000);
  });
});

describe("RateLimiter", () => {
  it("lets requests through at once while the minute's budget lasts", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requestsPerMinute: 10, tokensPerMinute: 1000 }, clock);
    expect((await limiter.acquire(400)).waitedMs).toBe(0);
    expect((await limiter.acquire(400)).waitedMs).toBe(0);
  });

  it("waits for the tokens to come back when the budget is spent", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requestsPerMinute: 10, tokensPerMinute: 600 }, clock);
    await limiter.acquire(600);
    // 600 tokens a minute is 10 a second: 300 more takes 30 s.
    expect((await limiter.acquire(300)).waitedMs).toBeCloseTo(30_000, -2);
  });

  it("waits for a request slot when the requests per minute are spent", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requestsPerMinute: 2, tokensPerMinute: 1_000_000 }, clock);
    await limiter.acquire(1);
    await limiter.acquire(1);
    expect((await limiter.acquire(1)).waitedMs).toBeCloseTo(30_000, -2);
  });

  it("takes no more than a minute's budget for one request, so a big one still goes", async () => {
    const limiter = new RateLimiter({ requestsPerMinute: 10, tokensPerMinute: 100 }, fakeClock());
    expect(await limiter.acquire(500)).toEqual({ waitedMs: 0, tokens: 100 });
  });

  it("charges the tokens a request really used, once its usage is known", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requestsPerMinute: 10, tokensPerMinute: 600 }, clock);
    const { tokens } = await limiter.acquire(100);
    // It used all 600: none are left, so 60 more (a tenth of a minute's) take 6 s. Without settle there were 500.
    limiter.settle(tokens, 600);
    expect((await limiter.acquire(60)).waitedMs).toBeCloseTo(6_000, -2);
  });
});

describe("estimateTokens", () => {
  it("counts about four characters a token, plus the most the answer may take", () => {
    const request = { input: "x".repeat(4000), max_output_tokens: 500 };
    expect(estimateTokens(request)).toBeGreaterThanOrEqual(1500);
    expect(estimateTokens(request)).toBeLessThan(1600);
  });
});

describe("retryAfterMs", () => {
  it("reads retry-after-ms first, then retry-after in seconds", () => {
    expect(retryAfterMs(new Headers({ "retry-after-ms": "250", "retry-after": "9" }))).toBe(250);
    expect(retryAfterMs(new Headers({ "retry-after": "2" }))).toBe(2000);
  });

  it("is null with no header", () => {
    expect(retryAfterMs(new Headers())).toBeNull();
    expect(retryAfterMs(undefined)).toBeNull();
  });
});

describe("backoffMs", () => {
  it("doubles with each attempt, with jitter", () => {
    expect(backoffMs(0, () => 1)).toBe(1000);
    expect(backoffMs(2, () => 1)).toBe(4000);
    expect(backoffMs(2, () => 0)).toBe(2000);
  });
});

describe("kindOfTooMany", () => {
  it("tells a spent quota, flex capacity and a rate limit apart", () => {
    expect(kindOfTooMany({ code: "insufficient_quota" })).toBe("quota");
    expect(kindOfTooMany({ code: "resource_unavailable" })).toBe("flex-capacity");
    expect(kindOfTooMany({ message: "Resource Unavailable: try again later" })).toBe("flex-capacity");
    expect(kindOfTooMany({ code: "rate_limit_exceeded" })).toBe("rate-limit");
  });
});

describe("guarded", () => {
  const limiter = () => new RateLimiter({ requestsPerMinute: 10_000, tokensPerMinute: 10_000_000 }, fakeClock());
  const ok = (value: string): Sent<string> => ({ ok: value });
  const tooMany = (code: string, retryAfter: number | null = null): Sent<string> => ({
    tooMany: { error: { code }, retryAfterMs: retryAfter },
    fail: () => {
      throw new Error(`429 ${code}`);
    },
  });

  function run(answers: Sent<string>[], request: Record<string, unknown> = { model: "gpt-6-luna", input: "hi" }) {
    const clock = fakeClock();
    const sent: Array<Record<string, unknown> | null> = [];
    const waits: number[] = [];
    const result = guarded({
      request,
      send: async (body) => {
        sent.push(body);
        return answers.shift()!;
      },
      used: () => ({ tokens: 10 }),
      limiterFor: () => limiter(),
      clock,
      random: () => 1,
      onWait: (ms) => waits.push(ms),
    });
    return { result, sent, waits, clock };
  }

  it("returns the answer", async () => {
    await expect(run([ok("a")]).result).resolves.toBe("a");
  });

  it("retries a rate limit after the time the API asks, and counts that time as waiting", async () => {
    const { result, sent, waits } = run([tooMany("rate_limit_exceeded", 1500), ok("a")]);
    await expect(result).resolves.toBe("a");
    expect(sent).toHaveLength(2);
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(1500);
  });

  it("gives up on a rate limit after a few tries", async () => {
    const answers = Array.from({ length: 20 }, () => tooMany("rate_limit_exceeded"));
    await expect(run(answers).result).rejects.toThrow("429 rate_limit_exceeded");
  });

  it("does not retry a spent quota", async () => {
    const { result, sent } = run([tooMany("insufficient_quota"), ok("a")]);
    await expect(result).rejects.toThrow("insufficient_quota");
    expect(sent).toHaveLength(1);
  });

  it("backs off on flex capacity, then sends the request on the standard tier", async () => {
    const flex = { model: "gpt-6.1-terra", input: "hi", service_tier: "flex" };
    const busy = () => tooMany("resource_unavailable");
    const { result, sent, clock } = run([busy(), busy(), busy(), busy(), ok("a")], flex);
    await expect(result).resolves.toBe("a");
    expect(sent.slice(0, 4).every((body) => body?.service_tier === "flex")).toBe(true);
    expect(sent[4]).not.toHaveProperty("service_tier");
    expect(clock.slept).toEqual([1000, 2000, 4000]);
  });

  it("charges the request's tokens to the limiter of its model", async () => {
    const own = limiter();
    const settle = vi.spyOn(own, "settle");
    await guarded({ request: { model: "gpt-6-luna", input: "hi" }, send: async () => ok("a"), used: () => ({ tokens: 99 }), limiterFor: () => own });
    expect(settle).toHaveBeenCalledWith(expect.any(Number), 99);
  });
});
