-- #58: which newsletters covered each story, for the board's proposed lead. Additive only: a new table, nothing
-- else changes. Ingestion and the board both work without it (they log and fall back to stories.source), so the
-- app can deploy before or after this migration. No backfill: the board already counts each row's own source.

-- CreateTable
CREATE TABLE "newsletter"."story_sources" (
    "story_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_sources_pkey" PRIMARY KEY ("story_id","source")
);
