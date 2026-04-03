-- Migration: Add subscriber auth tables for article gating
-- Date: 2026-04-03
-- Description: Stores local subscriber access state and one-time sign-in codes.

CREATE TABLE IF NOT EXISTS newsletter.subscribers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    source text NOT NULL DEFAULT 'article_gate',
    ghl_contact_id text,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscribers_email_key UNIQUE (email),
    CONSTRAINT subscribers_status_check CHECK (status IN ('active', 'unsubscribed'))
);

CREATE TABLE IF NOT EXISTS newsletter.auth_codes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL,
    code_hash text NOT NULL,
    purpose text NOT NULL DEFAULT 'sign_in',
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    request_ip text,
    request_user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS subscribers_status_idx
    ON newsletter.subscribers USING btree (status);

CREATE INDEX IF NOT EXISTS auth_codes_email_expires_idx
    ON newsletter.auth_codes USING btree (email, expires_at DESC);

CREATE OR REPLACE FUNCTION newsletter.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
ALTER FUNCTION newsletter.update_updated_at_column() OWNER TO neondb_owner;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'subscribers_updatedat') THEN
        CREATE TRIGGER subscribers_updatedat
        BEFORE UPDATE ON newsletter.subscribers
        FOR EACH ROW
        EXECUTE FUNCTION newsletter.update_updated_at_column();
    END IF;
END $$;
