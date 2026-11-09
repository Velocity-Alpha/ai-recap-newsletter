-- Rollback for 20261109073433_add_issue_draft_source. Prisma never runs this file.
-- Run it by hand, then: prisma migrate resolve --rolled-back 20261109073433_add_issue_draft_source
ALTER TABLE "newsletter"."issue_drafts" DROP COLUMN IF EXISTS "source_draft_id";
