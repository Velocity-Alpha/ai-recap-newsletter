-- Both columns are left from the move off n8n, and nothing reads or writes them (#151).
-- Apply this only after the code without these fields is live: older code selects both columns.
-- Dropping draft_owner also drops its CHECK constraint.
ALTER TABLE "newsletter"."approval_outlines" DROP COLUMN "draft_owner", DROP COLUMN "forwarded_at";
