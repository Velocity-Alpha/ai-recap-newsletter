-- Rollback for 20261109064500_add_issue_drafts_queued_at. Prisma never runs this file.
-- Run it by hand, then: prisma migrate resolve --rolled-back 20261109064500_add_issue_drafts_queued_at
ALTER TABLE "newsletter"."issue_drafts" DROP COLUMN IF EXISTS "queued_at";
