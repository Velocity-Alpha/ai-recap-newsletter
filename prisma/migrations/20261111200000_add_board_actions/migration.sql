-- Board actions (#150): how each commit changed the proposed board. Additive only: older code ignores the new
-- table and the new column. No subscriber data.
-- The runtime role gets its rights from the default privileges in prisma/bootstrap/001_grant_newsletter_web.sql.
-- `npm run prisma:migrate:prod:deploy` applies them again after the migration.

-- AlterTable
ALTER TABLE "newsletter"."approval_outlines" ADD COLUMN "proposed" JSONB;

-- CreateTable
CREATE TABLE "newsletter"."board_actions" (
    "id" BIGSERIAL NOT NULL,
    "outline_id" BIGINT NOT NULL,
    "issue_date" DATE NOT NULL,
    "story_id" INTEGER,
    "action" TEXT NOT NULL,
    "from_section" TEXT,
    "to_section" TEXT,
    "from_position" INTEGER,
    "to_position" INTEGER,
    "reason_code" TEXT,
    "reason_text" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_actions_outline_id_idx" ON "newsletter"."board_actions"("outline_id");

-- CreateIndex
CREATE INDEX "board_actions_issue_date_action_idx" ON "newsletter"."board_actions"("issue_date", "action");

-- Hand-written CHECK constraint (Prisma does not model it; see the /// note in schema.prisma).
ALTER TABLE "newsletter"."board_actions" ADD CONSTRAINT "board_actions_action_check" CHECK ("action" IN ('exclude', 'add', 'restore_repeat', 'move', 'reorder', 'lead', 'link'));
