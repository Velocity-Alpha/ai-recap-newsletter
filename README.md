# AI Recap Newsletter

AI Recap is a Next.js 16 App Router application for publishing and gating newsletter issues, browsing the archive, and collecting newsletter and for-brands leads.

## Stack

- Next.js 16
- TypeScript
- Tailwind CSS 4
- Prisma ORM with PostgreSQL
- Netlify hosting for the Next.js app

## Local development

The app runs directly on Next.js in local development. No `netlify dev` proxy or custom function harness is required.

### First-time setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the env template:
   ```bash
   cp .env.local.example .env.local
   ```
3. Fill in the required values in `.env.local`:
   - `APP_ENV=development` (the template already sets it; `npm run dev` stops without it)
   - `DATABASE_URL` (the Neon `dev` branch, not production)
   - `SESSION_SECRET`
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
   - `SUBSCRIBER_PROVIDER` (`beehiiv` or `ghl`; defaults to `beehiiv`)
   - `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID` when the provider is `beehiiv`
   - `GHL_SUBSCRIBE_WEBHOOK_URL` when the provider is `ghl`
   - `GHL_UNSUBSCRIBE_WEBHOOK_SECRET`
   - `APPROVAL_PASSWORD`
   - `N8N_WEBHOOK_JWT_SECRET`
   - `OPENROUTER_API_KEY`
4. If this local database already existed before Prisma Migrate was introduced, mark the baseline once:
   ```bash
   npm run prisma:migrate:baseline
   ```
5. If your local runtime user needs grants repaired or initialized, apply the bootstrap once:
   ```bash
   npm run db:bootstrap
   ```
6. Start the app:
   ```bash
   npm run dev
   ```

### Everyday development loop

1. Run the app:
   ```bash
   npm run dev
   ```
2. If you change application code only, no migration step is needed.
3. If you change the database schema, create and apply a Prisma migration:
   ```bash
   npm run prisma:migrate:dev -- --name describe_change
   ```
4. If the migration introduces new tables or sequences and your local runtime user is separate from your admin user, reapply grants:
   ```bash
   npm run db:bootstrap
   ```
5. Before pushing, run the full verification pass:
   ```bash
   npm run verify
   ```
   `npm install` turns on a git pre-push hook (`.githooks/pre-push`) that runs it for you and stops the push if it fails. Skip it once with `git push --no-verify`.

`npm run verify` runs lint, tests, and a production build in sequence.

Netlify bills the team in credits (Free plan: 300 a month). Deploy previews and failed builds use none. Each merge to `main` starts a production deploy, which uses 15 credits, so merge in batches when you can. When the credits run out, Netlify pauses the site until the next billing cycle.

## Prisma workflow

Prisma schema lives in `prisma/schema.prisma`, and the generated client is emitted into `src/generated/prisma` during install/build.

Core commands:

- `npm run prisma:generate` regenerates the Prisma client
- `npm run prisma:pull` introspects the current database into `prisma/schema.prisma`
- `npm run prisma:migrate:baseline` marks the `0_init` baseline as already applied on the database in `DATABASE_URL`
- `npm run prisma:migrate:dev -- --name describe_change` creates and applies a new migration in development
- `npm run prisma:migrate:status` shows migration status for the database in `DATABASE_URL`
- `npm run prisma:migrate:deploy` applies committed migrations to the database in `DATABASE_URL`
- `npm run db:bootstrap` reapplies the runtime grants in `prisma/bootstrap/001_grant_newsletter_web.sql` using `DATABASE_URL`
- `npm run db:bootstrap:prod` reapplies the same runtime grants using `PRODUCTION_DATABASE_URL`

This repo includes a baseline migration in `prisma/migrations/0_init`. Use the baseline command only once per existing database. New databases created through Prisma do not need that step.

The privilege bootstrap is intentionally kept separate from Prisma schema migrations. Prisma handles schema changes; the bootstrap script handles runtime access for `newsletter_web` across current and future tables/sequences in the `newsletter` schema.

## Production deploy workflow

Set `PRODUCTION_DATABASE_URL` in your local shell or `.env.local` when you need to target the production database from your machine. The `prisma:migrate:prod:*` scripts will fail fast with a clear message if that env var is missing.

### One-time production baseline

Run this once for an existing production database that already has the schema:

```bash
npm run prisma:migrate:prod:baseline
```

### Every production deploy that includes schema changes

1. Check production migration state:
   ```bash
   npm run prisma:migrate:prod:status
   ```
2. Apply committed migrations to production:
   ```bash
   npm run prisma:migrate:prod:deploy
   ```
   This command now runs the Prisma migration deploy first, then reapplies the `newsletter_web` grants automatically.
3. Deploy the application to Netlify after the production migration succeeds.

If a deploy does not include schema changes, you can skip the Prisma migrate step and deploy the app normally.

### One-time repair for an existing environment

If a runtime role like `newsletter_web` is already missing privileges, run:

```bash
npm run db:bootstrap
```

or for production:

```bash
npm run db:bootstrap:prod
```

## API routes

Read routes:

- `GET /api/newsletters?page=&limit=`
- `GET /api/newsletters/[id]`
- `GET /api/issues/[slug]`
- `GET /api/ticker`
- `GET /api/approval/outline?date=` for the password-protected approval board outline
- `GET /api/newsletters/outline?date=` for the authenticated newsletter outline API
- `GET /api/approval/issues/[id]/publish` previews what "Mark as published" would publish (approval session)

Mutation routes:

- `POST /api/for-brands`
- `POST /api/subscriber/subscribe`
- `POST /api/subscriber/request-code`
- `POST /api/subscriber/verify-code`
- The three routes above, and `POST /api/approval/login`, answer `429` with `Retry-After` once a caller passes its limit (per IP, with IPv6 grouped by /64; per email where there is one; and for the approval login, across the whole site). The IP comes from Netlify's `x-nf-client-connection-ip` header. Limits live in `src/server/rate-limit.ts`; counts are in `newsletter.rate_limits`.
- `POST /api/subscriber/sign-out`
- `GET|POST /api/subscriber/unsubscribe` with a signed `token`
- `POST /api/subscriber/unsubscribe/webhook` with `Authorization: Bearer <GHL_UNSUBSCRIBE_WEBHOOK_SECRET>` or `x-webhook-secret`
- `POST /api/newsletters/commit` to commit an approved outline to the generation webhook
- `POST /api/approval/issues/[id]/publish` publishes an unpublished draft from its stored email HTML (approval session). Used by the "Mark as published" button on `/approval/issues`. It sends no email.
- `POST /api/admin/stage-switches` with `{ key, value }` sets `ingest.owner`, `draft.owner`, or `publish.owner` to `n8n` or `native` (approval session). Used by `/admin/settings`. It refuses other keys and values, native drafting until #79, and changes to the current value. Each change is logged as a `pipeline_runs` row with job `admin-setting`.
- `proxy.ts` refuses writes (any method but GET, HEAD, OPTIONS) to `/approval/*`, `/api/approval/*`, `/api/newsletters/commit`, and `/api/admin/*` unless they come from this site's own origin (`403`), and refuses API writes that are not `Content-Type: application/json` (`415`). See `src/server/same-origin.ts`.
- `POST /api/revalidate` refreshes the cached issue lists, issue pages, and sitemap. It needs `Authorization: Bearer <token>`, a 5-minute token signed with a key derived from `SESSION_SECRET` (`src/server/cache-refresh-auth.ts`). The publish job calls it after it publishes an issue.

Public unsubscribe page:

- `GET /unsubscribe?token=...`

Admin pages (approval login; `proxy.ts` and `requireAdminPage()` in `src/server/admin-auth.ts` both check it):

- `/admin` overview, `/admin/runs` and `/admin/runs/[id]`, `/admin/incidents`, `/admin/settings` (every `pipeline_settings` row and the stage owner switches)

## Architecture

- Server-rendered pages read newsletter data through shared server helpers in `src/features/newsletter/server.ts`.
- Prisma Client is centralized in `src/server/prisma.ts`.
- The repository layer mixes Prisma model queries with Prisma-backed raw SQL for the complex ticker and archive queries.
- Route handlers under `app/api` provide the public JSON interface.

The homepage and archive lists, individual issue lookups, and sitemap entries share one data cache tag (`published-issues`, `src/features/newsletter/cache.ts`) and expire after one hour. Publishing refreshes the tag at once: "Mark as published" does it in the route, and the publish job calls `POST /api/revalidate`. n8n does not refresh it, so while n8n publishes, a new issue can take up to an hour to appear in the lists. `GET /api/newsletters` stays uncached and sends `Cache-Control: no-store`. The ticker keeps its five-minute data cache.

## Background jobs (Netlify functions)

Jobs run as Netlify functions in `netlify/functions/` (see `docs/adr/0001-job-runner.md`). The adapters stay thin; the logic lives in `src/pipeline/`. `src/trigger/` holds dormant Trigger.dev adapters for the same jobs. The `pipeline.runner` key in `newsletter.pipeline_settings` picks the runner that acts: `netlify` (the default) or `trigger`. The migration plan is in `docs/n8n-backend/70-migration-plan.md`.

- `detect-publish` reads the seed inbox (read-only) every 5 minutes on weekdays, 09:00–20:59 New York time, and `detect-publish-catch-up` looks back 3 days once a day. Each run checks Gmail first and opens the database only when an issue email arrived. The `publish.owner` key decides what happens next: `n8n` (the default) does nothing, `shadow` only records `publish_events` rows, and `native` publishes. The functions need `DATABASE_URL`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, and `GMAIL_OAUTH_REFRESH_TOKEN` as secret Netlify env vars, plus `PUBLISH_SEED_RECIPIENTS`. Set that to the one monitor seed address. Each send also reaches the owner's `+` alias in the same inbox; without the filter, the job reads every send twice. Secret vars use the scopes builds, functions, and runtime; the Free plan cannot narrow them further.
- `ingest-stories` collects the day's candidate stories at 09:55 New York time on weekdays. It reads 5 newsletters from the seed inbox (read-only) and the Product Hunt and Hugging Face feeds, extracts stories with `gpt-6-luna`, and saves them to `newsletter.stories` for the approval board. Then it sends the "stories are ready" message to the AI Recap Review Telegram group (production only; elsewhere the run log records the text). The scheduled function only starts `ingest-stories-background`, which does the work in up to 15 minutes; the call carries a 5-minute token signed with a key derived from `SESSION_SECRET`. The `ingest.owner` key decides who ingests: `n8n` (the default) or `native`. The job needs the Gmail variables above, `OPENAI_API_KEY`, and `TELEGRAM_REVIEW_BOT_TOKEN` (production only). Sources live in `src/pipeline/ingest/sources.ts`; each has a bookmark in `newsletter.scraper_bookmarks`, and a failed email is tried again on the next run. Each run is in `pipeline_runs` and `pipeline_events`.
- Scheduled functions fire only on the production deploy. To try one on a deploy preview (Neon `dev`), use "Run now" on the preview's function page in the Netlify UI. On a preview, `ingest-stories` runs at any time.
- Do this before merging a new job. A local bundle can still load packages from the repo's `node_modules`, so it can pass while the Netlify bundle fails. `netlify.toml` ships `@prisma/client-runtime-utils` with the jobs for this reason.

## Deploying to Netlify

This repository stays on Netlify, but it no longer uses hand-written Netlify Functions. Netlify deploys the Next.js app and its App Router route handlers directly.

Required environment variables:

- `APP_ENV` — `development`, `preview`, or `production`. Set per deploy context in `netlify.toml` (`production` for production, `preview` for deploy previews and branch deploys). `next build` fails without it.
- `DATABASE_URL` — production in the production context; the Neon `dev` branch for deploy previews and branch deploys
- `SESSION_SECRET` — signs subscriber sessions and, through derived keys, the job tokens (cache refresh, ingest start) and approval board sessions
- `OPENAI_API_KEY` — story extraction in the ingest job
- `TELEGRAM_REVIEW_BOT_TOKEN` — production only; the ingest job's "stories are ready" message
- `TELEGRAM_OPS_CHAT_ID` — production only; the "AI Recap Ops" chat where the review bot posts ops alerts (`src/pipeline/notify/`). Never the review group. Without it, alerts are not sent.
- `RESEND_API_KEY`
- `RESEND_FROM_NAME`
- `RESEND_FROM_EMAIL`
- `SUBSCRIBER_PROVIDER` — `beehiiv` (default) or `ghl`. Picks which list the subscribe form writes to; in `beehiiv` mode, sign-in also checks the reader is still active in Beehiiv; in `ghl` mode the welcome email is left to the GHL workflow (sign-in codes still go through Resend)
- `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID` when the provider is `beehiiv`
- `GHL_SUBSCRIBE_WEBHOOK_URL` when the provider is `ghl`
- `GHL_UNSUBSCRIBE_WEBHOOK_SECRET`
- `APPROVAL_PASSWORD` — the approval board password. With it or `SESSION_SECRET` unset, `/approval` stays locked in every environment
- `N8N_WEBHOOK_JWT_SECRET`
- `OPENROUTER_API_KEY`
- `FOR_BRANDS_WEBHOOK_URL` if you want to override the default for-brands destination
- `NEXT_PUBLIC_SITE_URL`

Optional:

- `PRODUCTION_DATABASE_URL` for running Prisma production migration commands from your local machine
- `OUTLINE_COMMIT_WEBHOOK_URL` to override the approval outline commit webhook destination. Defaults to the production n8n story approval webhook.
- `NEWSLETTER_RUNTIME_DB_ROLE` to override the runtime role name used by the bootstrap scripts. Defaults to `newsletter_web`.

Google Analytics IDs and `APP_ENV` are configured per deploy context in `netlify.toml`.
