-- Rollback for 20261111180000_add_issue_stories. Prisma never runs this file.
-- Run it by hand, then: prisma migrate resolve --rolled-back 20261111180000_add_issue_stories
DROP TABLE IF EXISTS "newsletter"."issue_stories";
