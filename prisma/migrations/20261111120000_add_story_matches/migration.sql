-- The repeat check (#90): one embedding for each story, and one row for each judged pair of stories. Additive only:
-- older code ignores the new tables and columns. No extension: the nearest-story search is arithmetic in the app.
-- The runtime role gets its rights from the default privileges in prisma/bootstrap/001_grant_newsletter_web.sql.
-- `npm run prisma:migrate:prod:deploy` applies them again after the migration.

-- CreateTable
CREATE TABLE "newsletter"."story_embeddings" (
    "story_id" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "vector" REAL[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_embeddings_pkey" PRIMARY KEY ("story_id")
);

-- Prisma models a list column as nullable in SQL; the check always writes 512 numbers.
ALTER TABLE "newsletter"."story_embeddings" ALTER COLUMN "vector" SET NOT NULL;

-- CreateTable
CREATE TABLE "newsletter"."story_matches" (
    "id" BIGSERIAL NOT NULL,
    "newer_story_id" INTEGER NOT NULL,
    "older_story_id" INTEGER NOT NULL,
    "similarity" REAL NOT NULL,
    "same" REAL NOT NULL,
    "news" REAL NOT NULL,
    "judged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "story_matches_newer_story_id_older_story_id_key" ON "newsletter"."story_matches"("newer_story_id", "older_story_id");

-- CreateIndex
CREATE INDEX "story_matches_older_story_id_idx" ON "newsletter"."story_matches"("older_story_id");

-- When the repeat check went through the story. NULL means not checked yet.
ALTER TABLE "newsletter"."stories" ADD COLUMN "matched_at" TIMESTAMPTZ(6);

-- The board date of the commit that excluded the story. NULL for stories excluded before #90.
ALTER TABLE "newsletter"."stories" ADD COLUMN "excluded_on" DATE;
