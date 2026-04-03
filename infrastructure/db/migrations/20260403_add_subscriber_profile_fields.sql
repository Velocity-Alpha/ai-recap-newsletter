-- Migration: Add subscriber profile fields
-- Date: 2026-04-03
-- Description: Stores first name and supports GHL contact lookups for unsubscribe sync.

ALTER TABLE newsletter.subscribers
    ADD COLUMN IF NOT EXISTS first_name text;

CREATE INDEX IF NOT EXISTS subscribers_ghl_contact_idx
    ON newsletter.subscribers USING btree (ghl_contact_id);
