-- Migration: Remove GHL contact ID dependency from local subscriber access
-- Date: 2026-04-03
-- Description: Subscriber access is keyed by email only.

DROP INDEX IF EXISTS newsletter.subscribers_ghl_contact_idx;

ALTER TABLE newsletter.subscribers
    DROP COLUMN IF EXISTS ghl_contact_id;
