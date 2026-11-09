-- "New image" drafts (#116): the ready draft whose written content a draft re-uses. Null for a commit's draft.
-- Additive and nullable: existing rows keep null.
ALTER TABLE "newsletter"."issue_drafts" ADD COLUMN "source_draft_id" BIGINT;
