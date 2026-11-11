-- Free links for paywalled stories (#59). Additive only: older code ignores the new tables and columns.
-- The runtime role gets its rights from the default privileges in prisma/bootstrap/001_grant_newsletter_web.sql.
-- `npm run prisma:migrate:prod:deploy` applies them again after the migration.

-- CreateTable
CREATE TABLE "newsletter"."story_free_links" (
    "id" BIGSERIAL NOT NULL,
    "story_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "title" TEXT,
    "words" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "origin_story_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_free_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "story_free_links_origin_check" CHECK ("origin" IN ('story', 'search'))
);

-- CreateIndex
CREATE UNIQUE INDEX "story_free_links_story_id_url_key" ON "newsletter"."story_free_links"("story_id", "url");

-- CreateTable
CREATE TABLE "newsletter"."paywall_sites" (
    "site" TEXT NOT NULL,
    "story_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paywall_sites_pkey" PRIMARY KEY ("site")
);

-- Prisma models a list column as nullable in SQL; the app always writes a list.
ALTER TABLE "newsletter"."paywall_sites" ALTER COLUMN "story_ids" SET NOT NULL;

-- When the search for free links finished for the story, also with no result. NULL means not searched.
ALTER TABLE "newsletter"."stories" ADD COLUMN "free_links_checked_at" TIMESTAMPTZ(6);

-- The link the story had before a commit first changed it. NULL means never changed.
ALTER TABLE "newsletter"."stories" ADD COLUMN "original_url" TEXT;
