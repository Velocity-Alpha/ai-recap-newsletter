ALTER TABLE newsletter.issues
ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS issues_slug_unique_idx
ON newsletter.issues (slug)
WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS issues_slug_idx
ON newsletter.issues USING btree (slug);
