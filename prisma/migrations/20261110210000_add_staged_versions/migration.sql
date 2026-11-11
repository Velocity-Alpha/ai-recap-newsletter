-- Staged versions (#149, ADR 0004): one row for each copy of a draft the owner staged for sending. A row never
-- changes after its status is 'staged'. Additive: older code ignores the new table and columns.
-- The runtime role gets its rights from the default privileges in prisma/bootstrap/001_grant_newsletter_web.sql,
-- like issue_drafts did. `npm run prisma:migrate:prod:deploy` applies them again after the migration.

-- CreateTable
CREATE TABLE "newsletter"."staged_versions" (
    "id" BIGSERIAL NOT NULL,
    "issue_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "draft_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "featured_image_url" TEXT,
    "scene_prompt" TEXT,
    "content" JSONB NOT NULL,
    "html" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "service_ref" TEXT,
    "service_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staged_at" TIMESTAMPTZ(6),

    CONSTRAINT "staged_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staged_versions_issue_id_version_key" ON "newsletter"."staged_versions"("issue_id", "version");

-- CreateIndex
CREATE INDEX "staged_versions_draft_id_idx" ON "newsletter"."staged_versions"("draft_id");

-- Hand-written CHECK constraints (Prisma does not model them; see the /// note in schema.prisma).
ALTER TABLE "newsletter"."staged_versions" ADD CONSTRAINT "staged_versions_status_check" CHECK ("status" IN ('staging', 'staged'));
ALTER TABLE "newsletter"."staged_versions" ADD CONSTRAINT "staged_versions_version_check" CHECK ("version" >= 1);

-- The staged version a sent email was made from (its data-version-id). NULL for emails staged before #149.
ALTER TABLE "newsletter"."publish_events" ADD COLUMN "staged_version_id" BIGINT;

-- When the owner last changed the draft's title or image in the app. NULL for a draft nobody changed.
ALTER TABLE "newsletter"."issue_drafts" ADD COLUMN "edited_at" TIMESTAMPTZ(6);

-- Backfill: every ready draft that has an email in the distribution service becomes a staged version with the
-- draft's number. Safe to run again: a version that exists is left alone.
-- backfill:start
INSERT INTO "newsletter"."staged_versions"
    ("issue_id", "version", "draft_id", "status", "title", "featured_image_url", "scene_prompt", "content", "html",
     "service", "service_ref", "service_url", "created_at", "staged_at")
SELECT d."issue_id", d."version", d."id", 'staged', COALESCE(d."content"->>'title', ''), d."featured_image_url",
       d."scene_prompt", d."content", d."html", 'ghl', d."ghl_template_id", d."ghl_preview_url",
       COALESCE(d."finished_at", d."created_at"), d."finished_at"
FROM "newsletter"."issue_drafts" d
WHERE d."status" = 'ready'
  AND d."ghl_template_id" IS NOT NULL
  AND d."content" IS NOT NULL
  AND d."html" IS NOT NULL
ON CONFLICT ("issue_id", "version") DO NOTHING;
-- backfill:end
