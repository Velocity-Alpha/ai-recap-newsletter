-- CreateTable
CREATE TABLE "newsletter"."issue_drafts" (
    "id" BIGSERIAL NOT NULL,
    "issue_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "outline_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "current_step" TEXT,
    "failed_step" TEXT,
    "error" TEXT,
    "content" JSONB,
    "html" TEXT,
    "featured_image_url" TEXT,
    "scene_prompt" TEXT,
    "ghl_template_id" TEXT,
    "ghl_preview_url" TEXT,
    "unread_story_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "issue_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "issue_drafts_issue_id_version_key" ON "newsletter"."issue_drafts"("issue_id", "version");

-- AlterTable
ALTER TABLE "newsletter"."publish_events" ADD COLUMN "draft_id" BIGINT;

-- CreateIndex
CREATE INDEX "publish_events_draft_id_idx" ON "newsletter"."publish_events"("draft_id");

-- Hand-written CHECK constraints (Prisma does not model them; see the /// note in schema.prisma).
ALTER TABLE "newsletter"."issue_drafts" ADD CONSTRAINT "issue_drafts_status_check" CHECK ("status" IN ('running', 'ready', 'failed'));
ALTER TABLE "newsletter"."issue_drafts" ADD CONSTRAINT "issue_drafts_version_check" CHECK ("version" >= 1);
