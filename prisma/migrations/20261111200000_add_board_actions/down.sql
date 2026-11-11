-- Rollback for 20261111200000_add_board_actions. Prisma never runs this file. A code rollback does not need it:
-- older code ignores the table and the column.
-- Run it by hand, then: prisma migrate resolve --rolled-back 20261111200000_add_board_actions
DROP TABLE IF EXISTS "newsletter"."board_actions";
ALTER TABLE "newsletter"."approval_outlines" DROP COLUMN IF EXISTS "proposed";
