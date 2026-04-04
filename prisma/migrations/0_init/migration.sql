--
-- PostgreSQL database dump
--

-- Dumped from database version 17.8 (a48d9ca)
-- Dumped by pg_dump version 17.5 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: newsletter; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA newsletter;


--
-- Name: slugify_issue_title(text); Type: FUNCTION; Schema: newsletter; Owner: -
--

CREATE FUNCTION newsletter.slugify_issue_title(input text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT NULLIF(
    trim(both '-' FROM
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(input),
            '[''’‘`´]+', '', 'g'      -- Apple's -> apples
          ),
          '\s*&\s*', ' and ', 'g'     -- A & B -> A and B
        ),
        '[^a-z0-9]+', '-', 'g'        -- collapse everything else to hyphens
      )
    ),
    ''
  );
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: newsletter; Owner: -
--

CREATE FUNCTION newsletter.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_updatedat_column(); Type: FUNCTION; Schema: newsletter; Owner: -
--

CREATE FUNCTION newsletter.update_updatedat_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auth_codes; Type: TABLE; Schema: newsletter; Owner: -
--

CREATE TABLE newsletter.auth_codes (
    id bigint NOT NULL,
    email text NOT NULL,
    code_hash text NOT NULL,
    purpose text DEFAULT 'sign_in'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    request_ip text,
    request_user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_codes_id_seq; Type: SEQUENCE; Schema: newsletter; Owner: -
--

ALTER TABLE newsletter.auth_codes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME newsletter.auth_codes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: issues; Type: TABLE; Schema: newsletter; Owner: -
--

CREATE TABLE newsletter.issues (
    id bigint NOT NULL,
    title text NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    html text,
    feature_image_url text,
    excerpt text,
    content_json jsonb,
    issue_date date,
    prompt_featured_image text,
    slug text GENERATED ALWAYS AS (COALESCE(newsletter.slugify_issue_title(title), (id)::text)) STORED
);


--
-- Name: issues_id_seq; Type: SEQUENCE; Schema: newsletter; Owner: -
--

CREATE SEQUENCE newsletter.issues_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: issues_id_seq; Type: SEQUENCE OWNED BY; Schema: newsletter; Owner: -
--

ALTER SEQUENCE newsletter.issues_id_seq OWNED BY newsletter.issues.id;


--
-- Name: scraper_bookmarks; Type: TABLE; Schema: newsletter; Owner: -
--

CREATE TABLE newsletter.scraper_bookmarks (
    source text NOT NULL,
    last_success timestamp with time zone NOT NULL
);


--
-- Name: stories; Type: TABLE; Schema: newsletter; Owner: -
--

CREATE TABLE newsletter.stories (
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
    used_in_publication_date date,
    queued_for_publication_date date,
    exclude_from_candidates boolean DEFAULT false
);


--
-- Name: stories_id_seq; Type: SEQUENCE; Schema: newsletter; Owner: -
--

CREATE SEQUENCE newsletter.stories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stories_id_seq; Type: SEQUENCE OWNED BY; Schema: newsletter; Owner: -
--

ALTER SEQUENCE newsletter.stories_id_seq OWNED BY newsletter.stories.id;


--
-- Name: subscribers; Type: TABLE; Schema: newsletter; Owner: -
--

CREATE TABLE newsletter.subscribers (
    id bigint NOT NULL,
    email text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    source text DEFAULT 'article_gate'::text NOT NULL,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    first_name text,
    CONSTRAINT subscribers_status_check CHECK ((status = ANY (ARRAY['active'::text, 'unsubscribed'::text])))
);


--
-- Name: subscribers_id_seq; Type: SEQUENCE; Schema: newsletter; Owner: -
--

ALTER TABLE newsletter.subscribers ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME newsletter.subscribers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: issues id; Type: DEFAULT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.issues ALTER COLUMN id SET DEFAULT nextval('newsletter.issues_id_seq'::regclass);


--
-- Name: stories id; Type: DEFAULT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.stories ALTER COLUMN id SET DEFAULT nextval('newsletter.stories_id_seq'::regclass);


--
-- Name: auth_codes auth_codes_pkey; Type: CONSTRAINT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.auth_codes
    ADD CONSTRAINT auth_codes_pkey PRIMARY KEY (id);


--
-- Name: issues issues_pkey; Type: CONSTRAINT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.issues
    ADD CONSTRAINT issues_pkey PRIMARY KEY (id);


--
-- Name: issues issues_slug_key; Type: CONSTRAINT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.issues
    ADD CONSTRAINT issues_slug_key UNIQUE (slug);


--
-- Name: issues issues_title_published_unique; Type: CONSTRAINT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.issues
    ADD CONSTRAINT issues_title_published_unique UNIQUE (title, published_at);


--
-- Name: scraper_bookmarks scraper_bookmarks_pkey; Type: CONSTRAINT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.scraper_bookmarks
    ADD CONSTRAINT scraper_bookmarks_pkey PRIMARY KEY (source);


--
-- Name: stories stories_guid_key; Type: CONSTRAINT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.stories
    ADD CONSTRAINT stories_guid_key UNIQUE (guid);


--
-- Name: stories stories_pkey; Type: CONSTRAINT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.stories
    ADD CONSTRAINT stories_pkey PRIMARY KEY (id);


--
-- Name: subscribers subscribers_email_key; Type: CONSTRAINT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.subscribers
    ADD CONSTRAINT subscribers_email_key UNIQUE (email);


--
-- Name: subscribers subscribers_pkey; Type: CONSTRAINT; Schema: newsletter; Owner: -
--

ALTER TABLE ONLY newsletter.subscribers
    ADD CONSTRAINT subscribers_pkey PRIMARY KEY (id);


--
-- Name: auth_codes_email_expires_idx; Type: INDEX; Schema: newsletter; Owner: -
--

CREATE INDEX auth_codes_email_expires_idx ON newsletter.auth_codes USING btree (email, expires_at DESC);


--
-- Name: issues_created_at_idx; Type: INDEX; Schema: newsletter; Owner: -
--

CREATE INDEX issues_created_at_idx ON newsletter.issues USING btree (created_at DESC);


--
-- Name: issues_published_at_idx; Type: INDEX; Schema: newsletter; Owner: -
--

CREATE INDEX issues_published_at_idx ON newsletter.issues USING btree (published_at DESC);


--
-- Name: queued_for_publication_date_idx; Type: INDEX; Schema: newsletter; Owner: -
--

CREATE INDEX queued_for_publication_date_idx ON newsletter.stories USING btree (queued_for_publication_date);


--
-- Name: subscribers_status_idx; Type: INDEX; Schema: newsletter; Owner: -
--

CREATE INDEX subscribers_status_idx ON newsletter.subscribers USING btree (status);


--
-- Name: stories stories_updatedat; Type: TRIGGER; Schema: newsletter; Owner: -
--

CREATE TRIGGER stories_updatedat BEFORE UPDATE ON newsletter.stories FOR EACH ROW EXECUTE FUNCTION newsletter.update_updatedat_column();


--
-- Name: subscribers subscribers_updatedat; Type: TRIGGER; Schema: newsletter; Owner: -
--

CREATE TRIGGER subscribers_updatedat BEFORE UPDATE ON newsletter.subscribers FOR EACH ROW EXECUTE FUNCTION newsletter.update_updated_at_column();


--
-- PostgreSQL database dump complete
--

