import type { IngestStore, StoryRow } from "@/src/pipeline/ingest/ingest";
import { prisma } from "@/src/server/prisma";

/** n8n's upsert (docs/n8n-backend/10-ingestion.md §4.6): the same columns on insert and on update. */
function storyData(row: StoryRow) {
  return {
    day: new Date(`${row.day}T00:00:00Z`),
    headline: row.headline,
    url: row.url,
    summary: row.summary,
    category: row.category,
    source: row.source,
    storyDetails: row.storyDetails,
    importanceScore: row.importanceScore,
    paywallDetected: row.paywallDetected,
    error: row.error,
  };
}

export function createPrismaIngestStore(): IngestStore {
  return {
    async readBookmark(source) {
      const row = await prisma.scraperBookmark.findUnique({ where: { source } });
      return row?.lastSuccess ?? null;
    },

    async writeBookmark(source, at) {
      await prisma.scraperBookmark.upsert({
        where: { source },
        create: { source, lastSuccess: at },
        update: { lastSuccess: at },
      });
    },

    async upsertStories(rows) {
      if (rows.length === 0) return 0;
      await prisma.$transaction(
        rows.map((row) =>
          prisma.story.upsert({
            where: { guid: row.guid },
            create: { guid: row.guid, ...storyData(row) },
            update: storyData(row),
          }),
        ),
      );
      return rows.length;
    },
  };
}
