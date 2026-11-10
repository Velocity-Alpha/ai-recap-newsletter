# AI Recap Newsletter

AI Recap is a weekday AI newsletter. This repo holds its website (issues, archive, subscriber sign-in, for-brands leads) and the pipeline jobs that collect stories, draft each issue, and publish it.

How the system works: [docs/architecture.html](./docs/architecture.html). This file covers setup, the database workflow, deploys, API routes, and environment variables.

## Stack

- Next.js 16
- TypeScript
- Tailwind CSS 4
- Prisma ORM with PostgreSQL
- Netlify: hosting, and the pipeline jobs as Netlify functions

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

   The full list is under [Environment variables](#environment-variables).
4. Start the app:
   ```bash
   npm run dev
   ```

### Before you push

```bash
APP_ENV=development npm run verify
```

It runs lint, tests, and a production build. `npm install` turns on a git pre-push hook (`.githooks/pre-push`) that runs it and stops the push if it fails.

Netlify bills in credits (Free plan: 300 a month). Each merge to `main` starts a production deploy, which uses 15. Deploy previews and failed builds use none. Merge in batches, and put `[skip netlify]` in the squash subject of a docs-only merge. When the credits run out, Netlify pauses the site until the next billing cycle.

## Database changes

The schema is `prisma/schema.prisma`. The generated client goes to `src/generated/prisma` during install and build.

1. Create a migration, and apply it to the Neon `dev` branch:
   ```bash
   npm run prisma:migrate:dev -- --name describe_change
   ```
   Add a `down.sql` next to `migration.sql` with the rollback. Prisma never runs it; it is there to run by hand.
2. With the owner, check production. Set `PRODUCTION_DATABASE_URL` in `.env.local` first.
   ```bash
   npm run prisma:migrate:prod:status
   ```
   It must list only the new migrations. If it lists `0_init`, stop: the pooled connection is looking in the wrong schema. Point `PRODUCTION_DATABASE_URL` at the direct host (the same host name without `-pooler`) and check again.
3. Apply the migrations to production before the code that needs them is merged:
   ```bash
   npm run prisma:migrate:prod:deploy
   ```
   This also reapplies the grants for the runtime role `newsletter_web` (`prisma/bootstrap/001_grant_newsletter_web.sql`). Grants are kept apart from migrations so they cover new tables too.

Other commands:

- `npm run prisma:migrate:status` and `npm run prisma:migrate:deploy` do the same for the database in `DATABASE_URL`.
- `npm run db:bootstrap` (or `db:bootstrap:prod`) reapplies the grants alone, if the runtime role is missing a privilege.
- `npm run db:reset-dev` resets the Neon `dev` branch from production, with fake subscribers.
- `npm run prisma:generate` regenerates the client. `npm run prisma:pull` reads the database into the schema file.

## API routes

Read routes:

- `GET /api/newsletters?page=&limit=`
- `GET /api/newsletters/[id]`
- `GET /api/issues/[slug]`
- `GET /api/ticker`
- `GET /api/approval/outline?date=` for the password-protected approval board outline
- `GET /api/approval/outline/marker?date=` the highest story id in the board's candidate window; the board reads it to spot stories newer than its cached copy (approval session)
- `GET /api/approval/outline/lead?response_id=` polls the AI lead pick that the dedup status check started; returns the picked lead and its reason (approval session)
- `GET /api/newsletters/outline?date=` for the authenticated newsletter outline API
- `GET /api/approval/issues/[id]/publish` previews what "Mark as published" would publish (approval session)
- `GET /api/approval/skipped-dates?date=` says whether a date is a skipped date (approval session)
- `GET /api/approval/drafts?date=` lists a date's drafts for the board (approval session)
- `GET /api/approval/drafts/[id]` one draft's status, polled by `/approval/drafts` while it runs (approval session)
- `GET /api/approval/drafts/[id]/html` the draft's email HTML for the sandboxed preview frame (approval session)

Mutation routes:

- `POST /api/for-brands`
- `POST /api/subscriber/subscribe`
- `POST /api/subscriber/request-code`
- `POST /api/subscriber/verify-code`
- The three routes above, and `POST /api/approval/login`, answer `429` with `Retry-After` once a caller passes its limit (per IP, with IPv6 grouped by /64; per email where there is one; and for the approval login, across the whole site). The IP comes from Netlify's `x-nf-client-connection-ip` header. Limits live in `src/server/rate-limit.ts`; counts are in `newsletter.rate_limits`.
- `POST /api/subscriber/sign-out`
- `GET|POST /api/subscriber/unsubscribe` with a signed `token`
- `POST /api/subscriber/unsubscribe/webhook` with `Authorization: Bearer <GHL_UNSUBSCRIBE_WEBHOOK_SECRET>` or `x-webhook-secret`
- `POST /api/newsletters/commit` commits an approved outline: it saves the story changes, makes the next draft, and starts `draft-issue-background`
- `POST /api/approval/drafts/[id]/retry` runs a failed or stuck draft again from the start (approval session)
- `POST /api/approval/drafts/[id]/image/ideas` three scene ideas for "New image" on a ready draft, from one GPT-6 Luna call (approval session; 30 per session per hour, then 429)
- `POST /api/approval/drafts/[id]/image/generate` makes one image from `{ scenePrompt }` plus the fixed style prompt and uploads it to S3; it makes no draft (approval session; 20 per session per hour, then 429)
- `POST /api/approval/drafts/[id]/image` "Use this image": `{ imageUrl, scenePrompt }` from "generate" becomes the issue's next draft, with the same text, new HTML, and a new GHL template; it starts `draft-issue-background` (approval session)
- `POST /api/approval/skipped-dates` with `{ date, note? }` marks a skipped date, and `DELETE /api/approval/skipped-dates?date=` undoes it, until that day is over (approval session). Used by "No issue today" on `/approval`.
- `POST /api/approval/issues/[id]/publish` publishes an unpublished draft from its stored email HTML (approval session). Used by the "Mark as published" button on `/approval/issues`. It sends no email.
- `POST /api/admin/stage-switches` sets a stage switch (approval session). The switches are left from the n8n migration: every stage is `native`, and `n8n` no longer works. Do not use it; #147 removes it.
- `proxy.ts` refuses writes (any method but GET, HEAD, OPTIONS) to `/approval/*`, `/api/approval/*`, `/api/newsletters/commit`, and `/api/admin/*` unless they come from this site's own origin (`403`), and refuses API writes that are not `Content-Type: application/json` (`415`). See `src/server/same-origin.ts`.
- `POST /api/revalidate` refreshes the cached issue lists, issue pages, and sitemap. It needs `Authorization: Bearer <token>`, a 5-minute token signed with a key derived from `SESSION_SECRET` (`src/server/cache-refresh-auth.ts`). The publish job calls it after it publishes an issue.

Public unsubscribe page:

- `GET /unsubscribe?token=...`

Admin pages (approval login; `proxy.ts` and `requireAdminPage()` in `src/server/admin-auth.ts` both check it):

- `/admin` overview, `/admin/runs` and `/admin/runs/[id]`, `/admin/incidents`, `/admin/settings` (every `pipeline_settings` row)

## Architecture

- Server-rendered pages read newsletter data through shared server helpers in `src/features/newsletter/server.ts`.
- Prisma Client is centralized in `src/server/prisma.ts`.
- The repository layer mixes Prisma model queries with Prisma-backed raw SQL for the complex ticker and archive queries.
- Route handlers under `app/api` provide the public JSON interface.

The homepage and archive lists, individual issue lookups, and sitemap entries share one data cache tag (`published-issues`, `src/features/newsletter/cache.ts`) and expire after one hour. Publishing refreshes the tag at once: "Mark as published" does it in the route, and the publish job calls `POST /api/revalidate`. `GET /api/newsletters` stays uncached and sends `Cache-Control: no-store`. The ticker keeps its five-minute data cache.

## Background jobs

The pipeline jobs are Netlify functions in `netlify/functions/`; their logic is in `src/pipeline/`. Schedules, limits, and what each job does: [docs/architecture.html](./docs/architecture.html#jobs). What to do when one fails: [docs/pipeline/runbook.md](./docs/pipeline/runbook.md).

## Environment variables

Netlify deploys the Next.js app and the functions in `netlify/functions/`. Values live in Netlify and `.env.local`, never in git. On Netlify, set the secret ones as secrets for production, deploy previews, and branch deploys.

Required:

- `APP_ENV` — `development`, `preview`, or `production`. Set per deploy context in `netlify.toml` (`production` for production, `preview` for deploy previews and branch deploys). `next build` fails without it.
- `DATABASE_URL` — production in the production context; the Neon `dev` branch for deploy previews and branch deploys
- `SESSION_SECRET` — signs subscriber sessions and, through derived keys, the job tokens (cache refresh, ingest start) and approval board sessions
- `OPENAI_API_KEY` — story extraction, dedup, the lead pick, and drafting
- `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN` — read-only access to the seed inbox, for the ingest and publish jobs
- `PUBLISH_SEED_RECIPIENTS` — the one monitor seed address. Each send also reaches the owner's `+` alias in the same inbox; without this filter the publish job reads every send twice
- `TELEGRAM_REVIEW_BOT_TOKEN` — production only; the ingest job's "stories are ready" message
- `TELEGRAM_OPS_CHAT_ID` — production only; the "AI Recap Ops" chat where the review bot posts ops alerts (`src/pipeline/notify/`). Never the review group. Without it, alerts are not sent.
- `HEALTHCHECKS_PING_URL` — production only; the Healthchecks.io ping URL for the daily summary. `run-checks` pings it after the 18:00 summary. Without it, the run log records "not configured".
- `RESEND_API_KEY`
- `RESEND_FROM_NAME`
- `RESEND_FROM_EMAIL`
- `SUBSCRIBER_PROVIDER` — `beehiiv` (default) or `ghl`. Picks which list the subscribe form writes to; in `beehiiv` mode, sign-in also checks the reader is still active in Beehiiv; in `ghl` mode the welcome email is left to the GHL workflow (sign-in codes still go through Resend)
- `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID` when the provider is `beehiiv`
- `GHL_SUBSCRIBE_WEBHOOK_URL` when the provider is `ghl`
- `GHL_UNSUBSCRIBE_WEBHOOK_SECRET`
- `APPROVAL_PASSWORD` — the approval board password. With it or `SESSION_SECRET` unset, `/approval` stays locked in every environment
- `APPROVAL_LEAD_PICK` (optional) — `off` skips the AI lead pick, so the board keeps the scored lead
- `FOR_BRANDS_WEBHOOK_URL` if you want to override the default for-brands destination
- `NEXT_PUBLIC_SITE_URL`
- `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`, `GHL_USER_ID` — production only; the draft job creates a new GHL email template per draft. Outside production the GHL calls are recorded, not sent.
- `VERTEX_API_KEY`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_BUCKET` — the draft job's featured image (`src/pipeline/draft/image`). Outside production the image still uploads, but only under `newsletter-dev/`; the prefix comes from `APP_ENV`.

Optional:

- `PRODUCTION_DATABASE_URL` for running Prisma production migration commands from your local machine
- `NEON_PROJECT_ID` for `npm run db:reset-dev`
- `TELEGRAM_REVIEW_CHAT_ID` to send the "stories are ready" message to another chat
- `NEWSLETTER_RUNTIME_DB_ROLE` to override the runtime role name used by the bootstrap scripts. Defaults to `newsletter_web`.
- `JINA_API_KEY` and `GITHUB_TOKEN` for the draft job's article reader (`src/pipeline/draft/articles`). Both work without a key: Jina Reader is the last fallback and is sent the key as a Bearer header only if set (higher rate limit); the GitHub token only raises the README API's rate limit.

Google Analytics IDs (`NEXT_PUBLIC_GA_MEASUREMENT_ID`) and `APP_ENV` are set per deploy context in `netlify.toml`. `APP_ENV` is also a Netlify env var with the same values, because functions cannot read `netlify.toml` at runtime.

Left from the n8n migration and unused while every stage is `native`: `N8N_WEBHOOK_JWT_SECRET`, `OUTLINE_COMMIT_WEBHOOK_URL`. #147 removes them.
