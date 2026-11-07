-- CreateTable
CREATE TABLE "newsletter"."publish_events" (
    "id" BIGSERIAL NOT NULL,
    "mode" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "gmail_message_id" TEXT,
    "received_at" TIMESTAMPTZ(6),
    "issue_id" BIGINT,
    "subject" TEXT,
    "title" TEXT,
    "story_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "content_json" JSONB,
    "problems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publish_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publish_events_issue_id_idx" ON "newsletter"."publish_events"("issue_id");

-- CreateIndex
CREATE INDEX "publish_events_created_at_idx" ON "newsletter"."publish_events"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "publish_events_mode_gmail_message_id_key" ON "newsletter"."publish_events"("mode", "gmail_message_id");

-- Hand-written CHECK constraints (Prisma does not model them; see the /// notes in schema.prisma).
ALTER TABLE "newsletter"."publish_events" ADD CONSTRAINT "publish_events_mode_check" CHECK ("mode" IN ('shadow', 'native', 'manual'));
ALTER TABLE "newsletter"."publish_events" ADD CONSTRAINT "publish_events_outcome_check" CHECK ("outcome" IN ('published', 'would_publish', 'already_published', 'unknown_issue', 'not_an_issue', 'needs_review'));
