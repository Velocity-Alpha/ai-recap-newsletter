import { describe, expect, it } from "vitest";

import { decideWrite, runDbSmoke, SMOKE_BOOKMARK_SOURCE, type SmokeDb } from "./db-smoke";

const DEV_URL = "postgresql://u:p@ep-quiet-rice-ahpzceaa.c-3.us-east-1.aws.neon.tech/neondb";
const PROD_URL = "postgresql://u:p@ep-divine-night-ahlkuqen-pooler.c-3.us-east-1.aws.neon.tech/neondb";
const PROD_DIRECT_URL = "postgresql://u:p@ep-divine-night-ahlkuqen.c-3.us-east-1.aws.neon.tech/neondb";

describe("decideWrite", () => {
  it("allows a requested write in the Trigger.dev Dev environment on a non-production database", () => {
    expect(
      decideWrite({ requested: true, environmentType: "DEVELOPMENT", databaseUrl: DEV_URL, productionDatabaseUrl: PROD_URL }),
    ).toEqual({ allowed: true });
  });

  it("skips the write when it was not requested", () => {
    expect(decideWrite({ requested: false, environmentType: "DEVELOPMENT", databaseUrl: DEV_URL })).toEqual({
      allowed: false,
      reason: "not requested",
    });
  });

  it("never writes in the Trigger.dev Production environment", () => {
    expect(decideWrite({ requested: true, environmentType: "PRODUCTION", databaseUrl: DEV_URL })).toEqual({
      allowed: false,
      reason: "writes are disabled in the PRODUCTION environment",
    });
  });

  it("refuses when DATABASE_URL points at the production endpoint, pooled or direct", () => {
    for (const databaseUrl of [PROD_URL, PROD_DIRECT_URL]) {
      expect(
        decideWrite({ requested: true, environmentType: "DEVELOPMENT", databaseUrl, productionDatabaseUrl: PROD_URL }),
      ).toEqual({ allowed: false, reason: "DATABASE_URL points at the production endpoint" });
    }
  });
});

function fakeDb(): SmokeDb & { upserts: Array<{ source: string; at: Date }> } {
  const upserts: Array<{ source: string; at: Date }> = [];
  return {
    upserts,
    countIssues: async () => 187,
    latestPublishedIssue: async () => ({
      id: BigInt(270),
      title: "AI Recap: Test",
      publishedAt: new Date("2026-11-05T15:00:00.000Z"),
    }),
    upsertBookmark: async (source, at) => {
      upserts.push({ source, at });
      return { source, lastSuccess: at };
    },
  };
}

describe("runDbSmoke", () => {
  const now = new Date("2026-11-06T16:00:00.000Z");

  it("reads the issue count and the latest published issue", async () => {
    const db = fakeDb();
    const result = await runDbSmoke(db, { write: { allowed: false, reason: "not requested" }, now });

    expect(result).toEqual({
      issueCount: 187,
      latestPublishedIssue: { id: "270", title: "AI Recap: Test", publishedAt: "2026-11-05T15:00:00.000Z" },
      wrote: null,
      writeSkippedReason: "not requested",
    });
    expect(db.upserts).toEqual([]);
  });

  it("upserts the smoke-test bookmark when the write is allowed", async () => {
    const db = fakeDb();
    const result = await runDbSmoke(db, { write: { allowed: true }, now });

    expect(db.upserts).toEqual([{ source: SMOKE_BOOKMARK_SOURCE, at: now }]);
    expect(result.wrote).toEqual({ source: SMOKE_BOOKMARK_SOURCE, lastSuccess: "2026-11-06T16:00:00.000Z" });
    expect(result.writeSkippedReason).toBeUndefined();
  });
});
