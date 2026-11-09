// Opt-in: runs against a real database that has the rate_limits migration, and cleans up after itself.
//   RATE_LIMIT_IT=1 DATABASE_URL=<a disposable database> npx vitest run src/server/rate-limit-store.integration.test.ts
// Use a database whose timezone is UTC (Neon's default); the clean-up test writes its fixture through Prisma.
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createPrismaRateLimitStore } from "@/src/server/rate-limit-store";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.RATE_LIMIT_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the rate limit integration test against production.");
}

describe.skipIf(!enabled)("rate_limits on a real database", () => {
  const tag = `it-${randomUUID()}`;
  const store = createPrismaRateLimitStore(prisma, () => 1);

  afterAll(async () => {
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: tag } } });
  });

  it("counts hits on one key and reports the time left in the window", async () => {
    const key = `${tag}:count`;

    expect((await store.hit(key, 900)).count).toBe(1);
    expect((await store.hit(key, 900)).count).toBe(2);
    const third = await store.hit(key, 900);

    expect(third.count).toBe(3);
    expect(third.retryAfterSeconds).toBeGreaterThan(890);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it("loses no count when hits arrive at the same time", async () => {
    const key = `${tag}:race`;

    const hits = await Promise.all(Array.from({ length: 20 }, () => store.hit(key, 900)));

    expect(hits.map((hit) => hit.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("starts a new window once the old one has passed", async () => {
    const key = `${tag}:window`;
    await store.hit(key, 1);
    await store.hit(key, 1);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect((await store.hit(key, 1)).count).toBe(1);
  });

  it("forgets a key on reset", async () => {
    const key = `${tag}:reset`;
    await store.hit(key, 900);
    await store.hit(key, 900);

    await store.reset(key);

    expect((await store.hit(key, 900)).count).toBe(1);
  });

  it("deletes counters a day old during clean-up, and keeps fresh ones", async () => {
    const stale = `${tag}:stale`;
    const fresh = `${tag}:fresh`;
    await prisma.rateLimit.create({
      data: { key: stale, count: 3, windowStartedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    await createPrismaRateLimitStore(prisma, () => 0).hit(fresh, 900);

    expect(await prisma.rateLimit.findUnique({ where: { key: stale } })).toBeNull();
    expect(await prisma.rateLimit.findUnique({ where: { key: fresh } })).not.toBeNull();
  });
});
