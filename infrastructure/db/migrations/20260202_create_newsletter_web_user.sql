-- Migration: Create read-only newsletter_web user
-- Date: 2026-02-02
-- Description: Creates a read-only user for the newsletter schema.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'newsletter_web') THEN
        CREATE ROLE newsletter_web WITH LOGIN PASSWORD '<change_this_password_to_a_secure_one>';
    END IF;
END
$$;

-- Grant usage on schema
GRANT USAGE ON SCHEMA newsletter TO newsletter_web;

-- Grant select on all existing tables
GRANT SELECT ON ALL TABLES IN SCHEMA newsletter TO newsletter_web;

-- Grant select on all existing sequences
GRANT SELECT ON ALL SEQUENCES IN SCHEMA newsletter TO newsletter_web;

-- Ensure future tables are also readable
ALTER DEFAULT PRIVILEGES IN SCHEMA newsletter GRANT SELECT ON TABLES TO newsletter_web;
ALTER DEFAULT PRIVILEGES IN SCHEMA newsletter GRANT SELECT ON SEQUENCES TO newsletter_web;
