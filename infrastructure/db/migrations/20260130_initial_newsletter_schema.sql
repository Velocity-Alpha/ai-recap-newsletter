-- Migration: Create newsletter schema and tables
-- Date: 2026-01-30
-- Description: Sets up the initial schema for newsletters, stories, and scraper tracking.

-- Create schema and set ownership
CREATE SCHEMA IF NOT EXISTS newsletter;
ALTER SCHEMA newsletter OWNER TO neondb_owner;

-- Create helper function for timestamp management
CREATE OR REPLACE FUNCTION newsletter.update_updatedat_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$;
ALTER FUNCTION newsletter.update_updatedat_column() OWNER TO neondb_owner;

-- Create issues table and sequence
CREATE TABLE IF NOT EXISTS newsletter.issues (
    id bigint NOT NULL,
    title text NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    html text NOT NULL,
    feature_image_url text,
    excerpt text,
    content_json jsonb,
    issue_date date
);
ALTER TABLE newsletter.issues OWNER TO neondb_owner;

CREATE SEQUENCE IF NOT EXISTS newsletter.issues_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE newsletter.issues_id_seq OWNER TO neondb_owner;
ALTER SEQUENCE newsletter.issues_id_seq OWNED BY newsletter.issues.id;
ALTER TABLE newsletter.issues ALTER COLUMN id SET DEFAULT nextval('newsletter.issues_id_seq'::regclass);

-- Create scraper_bookmarks table
CREATE TABLE IF NOT EXISTS newsletter.scraper_bookmarks (
    source text NOT NULL,
    last_success timestamp with time zone NOT NULL
);
ALTER TABLE newsletter.scraper_bookmarks OWNER TO neondb_owner;

-- Create stories table and sequence
CREATE TABLE IF NOT EXISTS newsletter.stories (
    id integer NOT NULL,
    guid text,
    day date,
    headline text,
    url text,
    summary text,
    category text,
    source text,
    "createdAt" timestamp with time zone DEFAULT now(),
    "updatedAt" timestamp with time zone DEFAULT now(),
    story_details text,
    importance_score smallint,
    used_in_publication_date date
);
ALTER TABLE newsletter.stories OWNER TO neondb_owner;

CREATE SEQUENCE IF NOT EXISTS newsletter.stories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE newsletter.stories_id_seq OWNER TO neondb_owner;
ALTER SEQUENCE newsletter.stories_id_seq OWNED BY newsletter.stories.id;
ALTER TABLE newsletter.stories ALTER COLUMN id SET DEFAULT nextval('newsletter.stories_id_seq'::regclass);

-- Add Constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_pkey') THEN
        ALTER TABLE newsletter.issues ADD CONSTRAINT issues_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_title_published_unique') THEN
        ALTER TABLE newsletter.issues ADD CONSTRAINT issues_title_published_unique UNIQUE (title, published_at);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scraper_bookmarks_pkey') THEN
        ALTER TABLE newsletter.scraper_bookmarks ADD CONSTRAINT scraper_bookmarks_pkey PRIMARY KEY (source);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_guid_key') THEN
        ALTER TABLE newsletter.stories ADD CONSTRAINT stories_guid_key UNIQUE (guid);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_pkey') THEN
        ALTER TABLE newsletter.stories ADD CONSTRAINT stories_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- Create Indexes
CREATE INDEX IF NOT EXISTS issues_created_at_idx ON newsletter.issues USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS issues_published_at_idx ON newsletter.issues USING btree (published_at DESC);

-- Create Trigger
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'stories_updatedat') THEN
        CREATE TRIGGER stories_updatedat BEFORE UPDATE ON newsletter.stories FOR EACH ROW EXECUTE FUNCTION newsletter.update_updatedat_column();
    END IF;
END $$;

-- Permissions and Roles
-- Note: Roles must be created manually or via environment-specific setup scripts
-- GRANT USAGE, CREATE ON SCHEMA newsletter TO newsletter_bot;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA newsletter TO newsletter_bot;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA newsletter TO newsletter_bot;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA newsletter GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO newsletter_bot;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA newsletter GRANT USAGE ON SEQUENCES TO newsletter_bot;
