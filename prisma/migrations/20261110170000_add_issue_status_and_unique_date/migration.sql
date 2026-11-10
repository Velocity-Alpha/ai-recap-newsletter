-- #82: an issue is a draft until it is published. The database computes status from published_at, so the two
-- can never disagree and no writer has to set both. To add a third state later, make it a plain column first:
--   ALTER TABLE "newsletter"."issues" ALTER COLUMN "status" DROP EXPRESSION;
ALTER TABLE "newsletter"."issues"
  ADD COLUMN "status" TEXT NOT NULL
  GENERATED ALWAYS AS (CASE WHEN "published_at" IS NULL THEN 'draft' ELSE 'published' END) STORED;

-- #82: one issue per date. #84 removed the duplicates n8n left, so this builds cleanly.
CREATE UNIQUE INDEX "issues_issue_date_key" ON "newsletter"."issues"("issue_date");
