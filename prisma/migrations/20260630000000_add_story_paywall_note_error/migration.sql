-- Add note, paywall_detected, and error columns to stories
ALTER TABLE "newsletter"."stories" ADD COLUMN "note" TEXT;
ALTER TABLE "newsletter"."stories" ADD COLUMN "paywall_detected" TEXT;
ALTER TABLE "newsletter"."stories" ADD COLUMN "error" TEXT;

-- Add note column to issues
ALTER TABLE "newsletter"."issues" ADD COLUMN "note" TEXT;
