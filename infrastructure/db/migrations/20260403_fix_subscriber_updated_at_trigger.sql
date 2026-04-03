-- Migration: Fix subscribers updated_at trigger
-- Date: 2026-04-03
-- Description: Subscribers use snake_case timestamps, so they need a dedicated trigger function.

CREATE OR REPLACE FUNCTION newsletter.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
ALTER FUNCTION newsletter.update_updated_at_column() OWNER TO neondb_owner;

DROP TRIGGER IF EXISTS subscribers_updatedat ON newsletter.subscribers;

CREATE TRIGGER subscribers_updatedat
    BEFORE UPDATE ON newsletter.subscribers
    FOR EACH ROW
    EXECUTE FUNCTION newsletter.update_updated_at_column();
