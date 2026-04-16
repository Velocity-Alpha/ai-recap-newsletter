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
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
   - `BEEHIIV_API_KEY`
   - `BEEHIIV_PUBLICATION_ID`
   - `BEEHIIV_UNSUBSCRIBE_WEBHOOK_SECRET`
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

`npm run verify` runs lint, tests, and a production build in sequence.

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

Mutation routes:

- `POST /api/for-brands`
- `POST /api/subscriber/subscribe`
- `POST /api/subscriber/request-code`
- `POST /api/subscriber/verify-code`
- `POST /api/subscriber/sign-out`
- `GET|POST /api/subscriber/unsubscribe` with a signed `token`
- `POST /api/subscriber/unsubscribe/webhook` with `Authorization: Bearer <BEEHIIV_UNSUBSCRIBE_WEBHOOK_SECRET>` or `x-webhook-secret`

Public unsubscribe page:

- `GET /unsubscribe?token=...`

## Architecture

- Server-rendered pages read newsletter data through shared server helpers in `src/features/newsletter/server.ts`.
- Prisma Client is centralized in `src/server/prisma.ts`.
- The repository layer mixes Prisma model queries with Prisma-backed raw SQL for the complex ticker and archive queries.
- Route handlers under `app/api` provide the public JSON interface.

## Deploying to Netlify

This repository stays on Netlify, but it no longer uses hand-written Netlify Functions. Netlify deploys the Next.js app and its App Router route handlers directly.

Required environment variables:

- `DATABASE_URL`
- `SESSION_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_NAME`
- `RESEND_FROM_EMAIL`
- `BEEHIIV_API_KEY`
- `BEEHIIV_PUBLICATION_ID`
- `BEEHIIV_UNSUBSCRIBE_WEBHOOK_SECRET`
- `FOR_BRANDS_WEBHOOK_URL` if you want to override the default for-brands destination
- `NEXT_PUBLIC_SITE_URL`

Optional:

- `PRODUCTION_DATABASE_URL` for running Prisma production migration commands from your local machine
- `NEWSLETTER_RUNTIME_DB_ROLE` to override the runtime role name used by the bootstrap scripts. Defaults to `newsletter_web`.

Google Analytics IDs remain configured per deploy context in `netlify.toml`.
