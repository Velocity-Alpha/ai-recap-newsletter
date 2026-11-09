-- CreateTable
CREATE TABLE "newsletter"."story_articles" (
    "id" BIGSERIAL NOT NULL,
    "story_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT,
    "final_url" TEXT,
    "text" TEXT,
    "chars" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "attempts" JSONB,
    "read_ms" INTEGER,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "story_articles_story_id_url_key" ON "newsletter"."story_articles"("story_id", "url");

-- Hand-written CHECK constraint (Prisma does not model it; see the /// note in schema.prisma).
ALTER TABLE "newsletter"."story_articles" ADD CONSTRAINT "story_articles_status_check" CHECK ("status" IN ('read', 'paywalled', 'blocked', 'failed'));
