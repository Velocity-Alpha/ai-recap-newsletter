# AI Recap Newsletter

AI Recap is a Next.js 16 App Router application for publishing and gating newsletter issues, browsing the archive, and collecting newsletter and for-brands leads.

## Stack

- Next.js 16
- TypeScript
- Tailwind CSS 4
- PostgreSQL via `pg`
- Netlify hosting for the Next.js app

## Local development

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
   - `GHL_SUBSCRIBE_WEBHOOK_URL`
4. Start the app:
   ```bash
   npm run dev
   ```

The app runs directly on Next.js in local development. No `netlify dev` proxy or custom function harness is required.

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
- `POST /api/subscriber/unsubscribe`

## Architecture

- Server-rendered pages read newsletter data through shared server helpers in `src/features/newsletter/server.ts`.
- Database access is centralized in `src/server/db.ts`.
- Raw newsletter SQL lives in `src/features/newsletter/repository.ts`.
- Route handlers under `app/api` provide the public JSON interface.

## Deploying to Netlify

This repository stays on Netlify, but it no longer uses hand-written Netlify Functions. Netlify deploys the Next.js app and its App Router route handlers directly.

Required environment variables:

- `DATABASE_URL`
- `SESSION_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_NAME`
- `RESEND_FROM_EMAIL`
- `GHL_SUBSCRIBE_WEBHOOK_URL`
- `FOR_BRANDS_WEBHOOK_URL` if you want to override the default for-brands destination
- `NEXT_PUBLIC_SITE_URL`

Google Analytics IDs remain configured per deploy context in `netlify.toml`.
