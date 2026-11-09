-- CreateTable
CREATE TABLE "newsletter"."approval_outlines" (
    "id" BIGSERIAL NOT NULL,
    "issue_date" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "draft_owner" TEXT NOT NULL,
    "committed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_outlines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_outlines_issue_date_committed_at_idx" ON "newsletter"."approval_outlines"("issue_date", "committed_at" DESC);

-- Hand-written CHECK constraint (Prisma does not model it; see the /// note in schema.prisma).
ALTER TABLE "newsletter"."approval_outlines" ADD CONSTRAINT "approval_outlines_draft_owner_check" CHECK ("draft_owner" IN ('n8n', 'native'));
