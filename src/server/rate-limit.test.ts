import { describe, expect, it } from "vitest";

import {
  consumeRateLimit,
  describeRetryAfter,
  RATE_LIMITS,
  resetRateLimit,
  type RateLimitRule,
} from "@/src/server/rate-limit";
import { createMemoryRateLimitStore, type RateLimitStore } from "@/src/server/rate-limit-store";

const rule: RateLimitRule = { name: "test", limit: 2, windowSeconds: 60 };

function recordingStore() {
  const inner = createMemoryRateLimitStore(() => 0);
  const keys: string[] = [];
  const store: RateLimitStore = {
    hit: (key, windowSeconds) => {
      keys.push(key);
      return inner.hit(key, windowSeconds);
    },
    reset: (key) => inner.reset(key),
  };
  return { store, keys };
}

describe("consumeRateLimit", () => {
  it("allows hits up to the limit, then blocks with a retry time", async () => {
    const { store } = recordingStore();

    expect(await consumeRateLimit(rule, "203.0.113.7", store)).toMatchObject({ allowed: true, count: 1 });
    expect(await consumeRateLimit(rule, "203.0.113.7", store)).toMatchObject({ allowed: true, count: 2 });
    expect(await consumeRateLimit(rule, "203.0.113.7", store)).toEqual({
      allowed: false,
      count: 3,
      retryAfterSeconds: 60,
    });
  });

  it("counts each identifier separately", async () => {
    const { store } = recordingStore();

    await consumeRateLimit(rule, "a@example.com", store);
    await consumeRateLimit(rule, "a@example.com", store);

    expect((await consumeRateLimit(rule, "b@example.com", store)).allowed).toBe(true);
  });

  it("stores a hash of the identifier, not the identifier", async () => {
    const { store, keys } = recordingStore();

    await consumeRateLimit(rule, "reader@example.com", store);

    expect(keys[0]).toMatch(/^test:[0-9a-f]{64}$/);
    expect(keys[0]).not.toContain("reader");
  });

  it("starts over after a reset", async () => {
    const { store } = recordingStore();

    await consumeRateLimit(rule, "203.0.113.7", store);
    await consumeRateLimit(rule, "203.0.113.7", store);
    await resetRateLimit(rule, "203.0.113.7", store);

    expect(await consumeRateLimit(rule, "203.0.113.7", store)).toMatchObject({ allowed: true, count: 1 });
  });
});

describe("RATE_LIMITS", () => {
  it("allows five tries per sign-in code and five approval logins per IP", () => {
    expect(RATE_LIMITS.signInCodeTries.limit).toBe(5);
    expect(RATE_LIMITS.approvalLogin.limit).toBe(5);
  });

  it("uses a distinct name for every rule", () => {
    const names = Object.values(RATE_LIMITS).map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("describeRetryAfter", () => {
  it("rounds up to whole minutes", () => {
    expect(describeRetryAfter(5)).toBe("about a minute");
    expect(describeRetryAfter(60)).toBe("about a minute");
    expect(describeRetryAfter(61)).toBe("about 2 minutes");
    expect(describeRetryAfter(900)).toBe("about 15 minutes");
  });
});
