-- Rollback for 20261109061500_add_issue_drafts. Prisma never runs this file.
-- Run it by hand, then: prisma migrate resolve --rolled-back 20261109061500_add_issue_drafts
DROP INDEX IF EXISTS "newsletter"."publish_events_draft_id_idx";
ALTER TABLE "newsletter"."publish_events" DROP COLUMN IF EXISTS "draft_id";
DROP TABLE IF EXISTS "newsletter"."issue_drafts";
