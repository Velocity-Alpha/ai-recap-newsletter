import { describe, expect, it, vi } from "vitest";

import {
  createMemoryRateLimitStore,
  createPrismaRateLimitStore,
  withFallbackStore,
  type RateLimitStore,
} from "@/src/server/rate-limit-store";

describe("memory rate limit store", () => {
  it("counts hits in a fixed window and reports when the window ends", async () => {
    let now = 1_000_000;
    const store = createMemoryRateLimitStore(() => now);

    expect(await store.hit("k", 60)).toEqual({ count: 1, retryAfterSeconds: 60 });
    now += 15_000;
    expect(await store.hit("k", 60)).toEqual({ count: 2, retryAfterSeconds: 45 });
  });

  it("starts a new window once the old one has passed", async () => {
    let now = 1_000_000;
    const store = createMemoryRateLimitStore(() => now);

    await store.hit("k", 60);
    await store.hit("k", 60);
    now += 60_000;

    expect(await store.hit("k", 60)).toEqual({ count: 1, retryAfterSeconds: 60 });
  });

  it("keeps keys apart and forgets a key on reset", async () => {
    const store = createMemoryRateLimitStore(() => 0);

    await store.hit("a", 60);
    await store.hit("a", 60);
    await store.hit("b", 60);
    await store.reset("a");

    expect((await store.hit("a", 60)).count).toBe(1);
    expect((await store.hit("b", 60)).count).toBe(2);
  });

  it("drops the oldest key when it holds too many", async () => {
    const store = createMemoryRateLimitStore(() => 0, 2);

    await store.hit("a", 60);
    await store.hit("b", 60);
    await store.hit("c", 60);

    expect((await store.hit("b", 60)).count).toBe(2);
    expect((await store.hit("a", 60)).count).toBe(1);
  });
});

describe("prisma rate limit store", () => {
  function fakeClient(rows: unknown[] = [{ count: 3, retry_after_seconds: 120 }]) {
    return {
      $queryRaw: vi.fn().mockResolvedValue(rows),
      $executeRaw: vi.fn().mockResolvedValue(0),
    };
  }

  function sqlOf(call: unknown[]) {
    const [strings, ...values] = call;
    return { sql: (strings as string[]).join("?"), values };
  }

  it("counts with one atomic upsert and returns the row's count", async () => {
    const client = fakeClient();
    const store = createPrismaRateLimitStore(client, () => 0.5);

    await expect(store.hit("approval-login:abc", 900)).resolves.toEqual({ count: 3, retryAfterSeconds: 120 });

    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
    const { sql, values } = sqlOf(client.$queryRaw.mock.calls[0]);
    expect(sql).toContain('INSERT INTO "newsletter"."rate_limits"');
    expect(sql).toContain("ON CONFLICT");
    expect(values).toContain("approval-login:abc");
    expect(values).toContain(900);
    expect(client.$executeRaw).not.toHaveBeenCalled();
  });

  it("now and then deletes counters whose window ended long ago", async () => {
    const client = fakeClient();
    const store = createPrismaRateLimitStore(client, () => 0);

    await store.hit("k", 60);

    expect(client.$executeRaw).toHaveBeenCalledTimes(1);
    expect(sqlOf(client.$executeRaw.mock.calls[0]).sql).toContain('DELETE FROM "newsletter"."rate_limits"');
  });

  it("does not fail the hit when the clean-up fails", async () => {
    const client = fakeClient();
    client.$executeRaw.mockRejectedValue(new Error("timeout"));
    const store = createPrismaRateLimitStore(client, () => 0);

    await expect(store.hit("k", 60)).resolves.toEqual({ count: 3, retryAfterSeconds: 120 });
  });

  it("fails when the upsert returns no row", async () => {
    const store = createPrismaRateLimitStore(fakeClient([]), () => 0.5);

    await expect(store.hit("k", 60)).rejects.toThrow();
  });

  it("deletes the key on reset", async () => {
    const client = fakeClient();
    const store = createPrismaRateLimitStore(client, () => 0.5);

    await store.reset("k");

    const { sql, values } = sqlOf(client.$executeRaw.mock.calls[0]);
    expect(sql).toContain('DELETE FROM "newsletter"."rate_limits"');
    expect(values).toEqual(["k"]);
  });
});

describe("withFallbackStore", () => {
  const failing: RateLimitStore = {
    hit: vi.fn().mockRejectedValue(new Error("relation does not exist")),
    reset: vi.fn().mockRejectedValue(new Error("relation does not exist")),
  };

  it("uses the primary store when it works", async () => {
    const primary = createMemoryRateLimitStore(() => 0);
    const fallback = createMemoryRateLimitStore(() => 0);
    const store = withFallbackStore(primary, fallback, vi.fn());

    await store.hit("k", 60);

    expect((await primary.hit("k", 60)).count).toBe(2);
    expect((await fallback.hit("k", 60)).count).toBe(1);
  });

  it("still limits through the fallback when the primary store fails, and reports the error", async () => {
    const onError = vi.fn();
    const store = withFallbackStore(failing, createMemoryRateLimitStore(() => 0), onError);

    await store.hit("k", 60);
    const second = await store.hit("k", 60);
    await store.reset("k");

    expect(second.count).toBe(2);
    expect((await store.hit("k", 60)).count).toBe(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
