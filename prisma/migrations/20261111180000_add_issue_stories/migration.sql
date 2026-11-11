-- The stories of each published issue (#118, ADR 0007). Additive only: older code ignores the new table.
-- The runtime role gets its rights from the default privileges in prisma/bootstrap/001_grant_newsletter_web.sql.
-- `npm run prisma:migrate:prod:deploy` applies them again after the migration.

-- CreateTable
CREATE TABLE "newsletter"."issue_stories" (
    "issue_id" BIGINT NOT NULL,
    "story_id" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT,
    "is_lead" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_stories_pkey" PRIMARY KEY ("issue_id", "story_id")
);

-- CreateIndex
CREATE INDEX "issue_stories_story_id_idx" ON "newsletter"."issue_stories"("story_id");

-- Hand-written CHECK constraint (Prisma does not model it; see the /// note in schema.prisma).
ALTER TABLE "newsletter"."issue_stories" ADD CONSTRAINT "issue_stories_section_check" CHECK ("section" IN ('headlines', 'research_and_analysis', 'tools', 'quick_hits'));

-- Backfill: one row for each story of each published issue, from the four section arrays of content_json.
-- Only an item with a whole-number story_id gets a row. position is the item's place in its array. is_lead stays
-- NULL: the sent draft of a past issue is not known here. A story listed twice in one issue keeps its first row.
-- Older issues use other keys (topStories, quickHits) with no story ids, and get no rows.
INSERT INTO "newsletter"."issue_stories" ("issue_id", "story_id", "section", "position", "url")
SELECT i."id", (item."value"->>'story_id')::integer, s."section", item."position"::integer, item."value"->>'url'
FROM "newsletter"."issues" i
CROSS JOIN (VALUES (1, 'headlines'), (2, 'research_and_analysis'), (3, 'tools'), (4, 'quick_hits')) AS s("section_order", "section")
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(i."content_json"->s."section") = 'array' THEN i."content_json"->s."section" ELSE '[]'::jsonb END
) WITH ORDINALITY AS item("value", "position")
WHERE i."published_at" IS NOT NULL
  AND jsonb_typeof(item."value"->'story_id') = 'number'
  AND item."value"->>'story_id' ~ '^[0-9]{1,9}$'
ORDER BY i."id", s."section_order", item."position"
ON CONFLICT DO NOTHING;
