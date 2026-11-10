-- Staged versions (#149, ADR 0004), step 2: from this deploy the draft job makes no email in the distribution
-- service. Drafts made between the first backfill (20261110210000_add_staged_versions) and this deploy still got
-- one from the draft job, so the same backfill runs once more for them. Data only: no table or column changes.
-- Safe to run again: a version that exists is left alone.
INSERT INTO "newsletter"."staged_versions"
    ("issue_id", "version", "draft_id", "status", "title", "featured_image_url", "scene_prompt", "content", "html",
     "service", "service_ref", "service_url", "created_at", "staged_at")
SELECT d."issue_id", d."version", d."id", 'staged', COALESCE(d."content"->>'title', ''), d."featured_image_url",
       d."scene_prompt", d."content", d."html", 'ghl', d."ghl_template_id", d."ghl_preview_url",
       COALESCE(d."finished_at", d."created_at"), d."finished_at"
FROM "newsletter"."issue_drafts" d
WHERE d."status" = 'ready'
  AND d."ghl_template_id" IS NOT NULL
  AND d."content" IS NOT NULL
  AND d."html" IS NOT NULL
ON CONFLICT ("issue_id", "version") DO NOTHING;
