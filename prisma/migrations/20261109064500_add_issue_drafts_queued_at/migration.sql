-- AlterTable
-- When a draft last waited for its job (create or retry). A draft whose job never starts is stuck after 5 minutes.
ALTER TABLE "newsletter"."issue_drafts" ADD COLUMN "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
