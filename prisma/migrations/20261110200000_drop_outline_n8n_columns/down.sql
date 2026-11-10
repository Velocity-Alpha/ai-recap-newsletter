-- The old values are not restored: every row gets 'native' and a null forwarded_at.
ALTER TABLE "newsletter"."approval_outlines"
  ADD COLUMN "draft_owner" TEXT NOT NULL DEFAULT 'native',
  ADD COLUMN "forwarded_at" TIMESTAMPTZ(6);
ALTER TABLE "newsletter"."approval_outlines" ADD CONSTRAINT "approval_outlines_draft_owner_check" CHECK ("draft_owner" IN ('n8n', 'native'));
