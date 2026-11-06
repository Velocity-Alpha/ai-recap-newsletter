-- Rollback for 20261106170000_add_pipeline_base_tables. Prisma never runs this file.
-- Run it by hand, then: prisma migrate resolve --rolled-back 20261106170000_add_pipeline_base_tables
DROP TABLE IF EXISTS "newsletter"."pipeline_events";
DROP TABLE IF EXISTS "newsletter"."pipeline_runs";
DROP TABLE IF EXISTS "newsletter"."pipeline_settings";
DROP TABLE IF EXISTS "newsletter"."alerts";
