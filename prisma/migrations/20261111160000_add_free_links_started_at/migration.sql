-- The search for free links (#59) claims a story before it works on it, so two runs at the same time do not
-- search the same story twice. Additive.
ALTER TABLE "newsletter"."stories" ADD COLUMN "free_links_started_at" TIMESTAMPTZ(6);
