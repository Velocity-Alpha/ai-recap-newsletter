import type { IngestStore, StoryRow } from "@/src/pipeline/ingest/ingest";
import { logServerError } from "@/src/server/observability";
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

/**
 * Keeps every newsletter that covered a story (#58): the upsert above overwrites `source` when a second newsletter
 * sends the same link on the same day. Coverage only shapes the board's proposed lead, so a failure here (for
 * example before the table's migration) is logged and never fails the stories it saved.
 */
async function recordSources(mentions: { storyId: number; source: string }[]): Promise<void> {
  try {
    await prisma.storySource.createMany({ data: mentions, skipDuplicates: true });
  } catch (error) {
    logServerError("ingest.story_sources.failed", error, { storyCount: mentions.length });
  }
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
      const saved = await prisma.$transaction(
        rows.map((row) =>
          prisma.story.upsert({
            where: { guid: row.guid },
            create: { guid: row.guid, ...storyData(row) },
            update: storyData(row),
            select: { id: true },
          }),
        ),
      );
      await recordSources(saved.map((story, index) => ({ storyId: story.id, source: rows[index].source })));
      return rows.length;
    },
  };
}
