-- draft_owner is left from the move off n8n. With a default, the code can stop writing it, and a later
-- migration can drop the column once that code is live (#151).
ALTER TABLE "newsletter"."approval_outlines" ALTER COLUMN "draft_owner" SET DEFAULT 'native';
