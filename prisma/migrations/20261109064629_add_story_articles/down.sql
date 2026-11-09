-- Rollback for 20261109064629_add_story_articles. Prisma never runs this file.
-- Run it by hand, then: prisma migrate resolve --rolled-back 20261109064629_add_story_articles
DROP TABLE IF EXISTS "newsletter"."story_articles";
