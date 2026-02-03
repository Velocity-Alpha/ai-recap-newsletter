-- Migration: Create developer users borna and franca
-- Date: 2026-02-03
-- Description: Creates users with read/write access to the newsletter schema but no DDL permissions.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'borna') THEN
        CREATE ROLE borna WITH LOGIN PASSWORD 'change_this_to_a_secure_password_borna';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'franca') THEN
        CREATE ROLE franca WITH LOGIN PASSWORD 'change_this_to_a_secure_password_franca';
    END IF;
END
$$;

-- Grant usage on schema
GRANT USAGE ON SCHEMA newsletter TO borna, franca;

-- Grant SELECT, INSERT, UPDATE, DELETE on all existing tables in schema newsletter
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA newsletter TO borna, franca;

-- Grant USAGE, SELECT, UPDATE on all existing sequences in schema newsletter
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA newsletter TO borna, franca;

-- Ensure future tables/sequences in schema newsletter are also accessible by these users
ALTER DEFAULT PRIVILEGES IN SCHEMA newsletter GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO borna, franca;
ALTER DEFAULT PRIVILEGES IN SCHEMA newsletter GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO borna, franca;
