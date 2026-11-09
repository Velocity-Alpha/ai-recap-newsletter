import { logServerError } from "@/src/server/observability";
import { prisma } from "@/src/server/prisma";

/** The count for a key after one more hit, and the seconds until its window ends. */
export type RateLimitHit = { count: number; retryAfterSeconds: number };

/** Fixed-window counters. A key's window starts at its first hit and lasts `windowSeconds`. */
export interface RateLimitStore {
  hit(key: string, windowSeconds: number): Promise<RateLimitHit>;
  reset(key: string): Promise<void>;
}

const MEMORY_STORE_MAX_KEYS = 10_000;

/** Counts in this process only. Each serverless instance has its own copy, so it is only the fallback. */
export function createMemoryRateLimitStore(
  now: () => number = Date.now,
  maxKeys = MEMORY_STORE_MAX_KEYS,
): RateLimitStore {
  const windows = new Map<string, { count: number; startedAt: number }>();

  return {
    async hit(key, windowSeconds) {
      const time = now();
      const windowMs = windowSeconds * 1000;
      let entry = windows.get(key);

      if (!entry || entry.startedAt + windowMs <= time) {
        windows.delete(key);
        if (windows.size >= maxKeys) {
          // Maps keep insertion order, so the first key is the oldest window.
          windows.delete(windows.keys().next().value as string);
        }
        entry = { count: 0, startedAt: time };
        windows.set(key, entry);
      }

      entry.count += 1;
      return { count: entry.count, retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + windowMs - time) / 1000)) };
    },
    async reset(key) {
      windows.delete(key);
    },
  };
}

type RawSqlClient = {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<unknown>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
};

// Every window is an hour or less, so a counter older than a day is dead.
const STALE_AFTER_SECONDS = 24 * 60 * 60;
const CLEANUP_CHANCE = 0.01;

/** Counts in `newsletter.rate_limits`, so every serverless instance sees the same numbers. */
export function createPrismaRateLimitStore(
  client: RawSqlClient = prisma,
  random: () => number = Math.random,
): RateLimitStore {
  return {
    async hit(key, windowSeconds) {
      // One statement, so concurrent hits on the same key cannot lose a count.
      const rows = (await client.$queryRaw`
        INSERT INTO "newsletter"."rate_limits" AS r ("key", "count", "window_started_at")
        VALUES (${key}, 1, now())
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE
            WHEN r."window_started_at" <= now() - make_interval(secs => ${windowSeconds}::int) THEN 1
            ELSE r."count" + 1
          END,
          "window_started_at" = CASE
            WHEN r."window_started_at" <= now() - make_interval(secs => ${windowSeconds}::int) THEN now()
            ELSE r."window_started_at"
          END
        RETURNING
          "count",
          GREATEST(
            1,
            CEIL(EXTRACT(EPOCH FROM ("window_started_at" + make_interval(secs => ${windowSeconds}::int) - now())))
          )::int AS "retry_after_seconds"
      `) as Array<{ count: number; retry_after_seconds: number }>;

      const row = rows[0];
      if (!row) throw new Error("rate_limits upsert returned no row.");

      if (random() < CLEANUP_CHANCE) {
        try {
          await client.$executeRaw`
            DELETE FROM "newsletter"."rate_limits"
            WHERE "window_started_at" < now() - make_interval(secs => ${STALE_AFTER_SECONDS}::int)
          `;
        } catch (error) {
          logServerError("rate_limit.cleanup_failed", error);
        }
      }

      return { count: Number(row.count), retryAfterSeconds: Number(row.retry_after_seconds) };
    },
    async reset(key) {
      await client.$executeRaw`DELETE FROM "newsletter"."rate_limits" WHERE "key" = ${key}`;
    },
  };
}

/**
 * Uses `primary`, and `fallback` when `primary` throws. A database outage (or a deploy that lands
 * before its migration) then keeps limits per instance instead of locking everyone out or letting
 * every attempt through.
 */
export function withFallbackStore(
  primary: RateLimitStore,
  fallback: RateLimitStore,
  onError: (error: unknown) => void,
): RateLimitStore {
  return {
    async hit(key, windowSeconds) {
      try {
        return await primary.hit(key, windowSeconds);
      } catch (error) {
        onError(error);
        return fallback.hit(key, windowSeconds);
      }
    },
    async reset(key) {
      await fallback.reset(key);
      try {
        await primary.reset(key);
      } catch (error) {
        onError(error);
      }
    },
  };
}

let defaultStore: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
  defaultStore ??= withFallbackStore(createPrismaRateLimitStore(), createMemoryRateLimitStore(), (error) =>
    logServerError("rate_limit.store_failed", error),
  );
  return defaultStore;
}
