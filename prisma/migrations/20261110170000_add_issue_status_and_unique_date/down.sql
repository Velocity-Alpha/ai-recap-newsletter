-- Rollback for 20261110170000_add_issue_status_and_unique_date. Prisma never runs this file.
-- Run it by hand, then: prisma migrate resolve --rolled-back 20261110170000_add_issue_status_and_unique_date
DROP INDEX IF EXISTS "newsletter"."issues_issue_date_key";
ALTER TABLE "newsletter"."issues" DROP COLUMN IF EXISTS "status";
