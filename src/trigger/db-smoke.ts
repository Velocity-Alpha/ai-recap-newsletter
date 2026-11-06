import { logger, task } from "@trigger.dev/sdk";

import { getPrisma } from "@/src/server/prisma";

// Row written by the smoke test. n8n looks up bookmarks by its own source keys, so it never reads this one.
export const SMOKE_BOOKMARK_SOURCE = "trigger_smoke_test";

export type DbSmokePayload = { write?: boolean };

export type WriteDecision = { allowed: true } | { allowed: false; reason: string };

export type DbSmokeResult = {
  issueCount: number;
  latestPublishedIssue: { id: string; title: string; publishedAt: string | null } | null;
  wrote: { source: string; lastSuccess: string } | null;
  writeSkippedReason?: string;
};

export interface SmokeDb {
  countIssues(): Promise<number>;
  latestPublishedIssue(): Promise<{ id: bigint; title: string; publishedAt: Date | null } | null>;
  upsertBookmark(source: string, at: Date): Promise<{ source: string; lastSuccess: Date }>;
}

// Neon endpoint id, e.g. "ep-divine-night-ahlkuqen". The pooled and direct hosts share it.
function neonEndpoint(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return null;
  }
}

export function decideWrite(input: {
  requested: boolean;
  environmentType: string;
  databaseUrl?: string;
  productionDatabaseUrl?: string;
}): WriteDecision {
  if (!input.requested) return { allowed: false, reason: "not requested" };
  if (input.environmentType === "PRODUCTION") {
    return { allowed: false, reason: "writes are disabled in the PRODUCTION environment" };
  }
  const productionEndpoint = neonEndpoint(input.productionDatabaseUrl);
  if (productionEndpoint && neonEndpoint(input.databaseUrl) === productionEndpoint) {
    return { allowed: false, reason: "DATABASE_URL points at the production endpoint" };
  }
  return { allowed: true };
}

export async function runDbSmoke(db: SmokeDb, options: { write: WriteDecision; now: Date }): Promise<DbSmokeResult> {
  const [issueCount, latest] = await Promise.all([db.countIssues(), db.latestPublishedIssue()]);
  const result: DbSmokeResult = {
    issueCount,
    latestPublishedIssue: latest
      ? { id: latest.id.toString(), title: latest.title, publishedAt: latest.publishedAt?.toISOString() ?? null }
      : null,
    wrote: null,
  };

  if (!options.write.allowed) {
    result.writeSkippedReason = options.write.reason;
    return result;
  }

  const row = await db.upsertBookmark(SMOKE_BOOKMARK_SOURCE, options.now);
  result.wrote = { source: row.source, lastSuccess: row.lastSuccess.toISOString() };
  return result;
}

function prismaSmokeDb(): SmokeDb {
  const prisma = getPrisma();
  return {
    countIssues: () => prisma.issue.count(),
    latestPublishedIssue: () =>
      prisma.issue.findFirst({
        where: { publishedAt: { not: null } },
        orderBy: { publishedAt: "desc" },
        select: { id: true, title: true, publishedAt: true },
      }),
    upsertBookmark: (source, at) =>
      prisma.scraperBookmark.upsert({
        where: { source },
        create: { source, lastSuccess: at },
        update: { lastSuccess: at },
      }),
  };
}

// Proves that a Trigger.dev task can read (and, in Dev only, write) Postgres through Prisma 7 and the pg adapter.
export const dbSmokeTask = task({
  id: "db-smoke",
  maxDuration: 60,
  run: async (payload: DbSmokePayload, { ctx }): Promise<DbSmokeResult> => {
    const write = decideWrite({
      requested: payload.write === true,
      environmentType: ctx.environment.type,
      databaseUrl: process.env.DATABASE_URL,
      productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL,
    });
    const result = await runDbSmoke(prismaSmokeDb(), { write, now: new Date() });
    logger.info("db-smoke finished", { environment: ctx.environment.type, ...result });
    return result;
  },
});
