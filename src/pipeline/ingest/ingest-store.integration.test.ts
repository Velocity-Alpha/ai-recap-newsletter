// Opt-in: runs against a real database and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/ingest/ingest-store.integration.test.ts
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { StoryRow } from "@/src/pipeline/ingest/ingest";
import { createPrismaIngestStore } from "@/src/pipeline/ingest/ingest-store";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.PIPELINE_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the ingest store integration test against production.");
}

describe.skipIf(!enabled)("ingest store on a real database", () => {
  const tag = `it-${randomUUID()}`;
  const store = createPrismaIngestStore();

  afterAll(async () => {
    await prisma.storySource.deleteMany({ where: { source: { startsWith: tag } } });
    await prisma.story.deleteMany({ where: { guid: { startsWith: tag } } });
    await prisma.scraperBookmark.deleteMany({ where: { source: tag } });
  });

  const row: StoryRow = {
    guid: `${tag}-1`,
    day: "2026-11-09",
    headline: "First headline",
    url: "https://example.org/it",
    summary: "Summary.",
    category: "Tools",
    source: tag,
    storyDetails: "Detail.",
    importanceScore: 3,
    paywallDetected: "no",
    error: "",
  };

  it("inserts, then updates by guid without touching approval columns", async () => {
    await expect(store.upsertStories([row])).resolves.toBe(1);
    await prisma.story.update({ where: { guid: row.guid }, data: { excludeFromCandidates: true, note: "kept" } });

    await store.upsertStories([{ ...row, headline: "Second headline", importanceScore: 4 }]);
    const saved = await prisma.story.findUniqueOrThrow({ where: { guid: row.guid } });
    expect(saved).toMatchObject({
      headline: "Second headline",
      importanceScore: 4,
      day: new Date("2026-11-09T00:00:00Z"),
      excludeFromCandidates: true,
      note: "kept",
    });
  });

  it("records each newsletter that sent the same story once (#58)", async () => {
    await store.upsertStories([row]);
    await store.upsertStories([{ ...row, source: `${tag}-second` }]);
    await store.upsertStories([{ ...row, source: `${tag}-second` }]);
    const saved = await prisma.story.findUniqueOrThrow({ where: { guid: row.guid } });

    const sources = await prisma.storySource.findMany({ where: { storyId: saved.id }, orderBy: { source: "asc" } });
    expect(sources.map((mention) => mention.source)).toEqual([tag, `${tag}-second`]);
  });

  it("reads and writes bookmarks", async () => {
    await expect(store.readBookmark(tag)).resolves.toBeNull();
    const at = new Date("2026-11-09T14:10:00Z");
    await store.writeBookmark(tag, at);
    await expect(store.readBookmark(tag)).resolves.toEqual(at);
  });
});
