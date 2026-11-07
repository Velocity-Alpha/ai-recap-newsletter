# 0001 — Job runner for the pipeline: Netlify functions

- **Status:** Accepted, 2026-11-07. Replaces the proposed "Trigger.dev Free" version in draft PR #98.
- **Issue:** #46 (parent #36). Background: `docs/research/free-job-runners.md`,
  `docs/n8n-backend/70-migration-plan.md` §3.

## Context

The pipeline leaves n8n step by step. It needs a $0 runner that:
- runs repo TypeScript and Prisma 7 against Neon;
- runs AI calls of up to about 300 s;
- runs at New York wall-clock times;
- keeps Neon asleep between checks (plan §3.2: Neon Free, about 80 of 100 compute-hours already used).

The plan picked Trigger.dev Free, with Inngest Free as the fallback. The Trigger.dev test passed in Dev, but
Production deploys fail with "Deployments are not available for this organization" (2026-11-06, again on
2026-11-07). Trigger.dev support has not answered. The owner wants to move off n8n without waiting.

## Decision

Run pipeline jobs as **Netlify functions in this repo**, next to the website:
- **Scheduled functions** for short checks (Netlify stops them at 30 s). Netlify cron is UTC only, so each
  job checks New York time in code (`src/pipeline/publish/publish-schedule.ts`).
- **Background functions** for long work such as ingestion and drafting (up to 15 minutes; on all
  credit-based plans, including Free; Netlify retries a failed run twice). They come with the first long job.
- **Job logic stays runner-neutral** in `src/pipeline/`. Each runner has a thin adapter:
  `netlify/functions/` (active) and `src/trigger/` (dormant).
- **`pipeline.runner`** in `pipeline_settings` (`netlify` by default, or `trigger`) says which runner acts.
  The other one stops after its first cheap check.
- **Check outside sources before the database.** Publish detection reads Gmail first and opens the database
  only when an issue email arrived.

First job: publish detection (`netlify/functions/detect-publish.mts`, every 5 minutes on weekdays
09:00–20:59 New York, and `detect-publish-catch-up.mts`, daily, 3-day lookback).

## Why not the others

- **Trigger.dev Free:** blocked by the vendor, with no reason given. Free also rejects schedules that fire
  more than once an hour, so polls need an hourly loop.
- **Inngest Free:** a second vendor account that could be restricted the same way. Every step still runs
  inside Netlify's 60 s limit, so each long AI call must go through `step.ai.infer` or `step.fetch`, whose
  timeouts are not documented.

## Consequences

- **Credits.** Jobs share the Netlify plan's 300 credits a month with the site and with production deploys
  (15 each). Estimate: publish detection about 10–20 credits a month; all jobs about 35–55. If credits run out,
  Netlify pauses the site, so watch usage.
- **No run dashboard.** History lives in `pipeline_runs` and `pipeline_events`. Netlify function logs are
  short-lived. Alerts come from the outcome checks and Healthchecks.io (plan Phase 1).
- **Previews.** Scheduled functions fire only on the published production deploy. On a deploy preview
  (Neon `dev`), start one with "Run now" in the Netlify UI, or bundle it with esbuild and run it locally.
- **Env vars.** Functions read secret Netlify env vars (`DATABASE_URL`, `GMAIL_OAUTH_*`). On the Free plan a
  secret var gets the scopes builds, functions, and runtime; it cannot be limited to functions only.

## Switching to Trigger.dev later

If Trigger.dev lifts the block and the owner wants it:
1. Set Trigger.dev Production env vars: `DATABASE_URL` and `GMAIL_OAUTH_*`.
2. `npx trigger.dev deploy --env prod`. The tasks in `src/trigger/detect-publish.ts` use hourly schedules
   with a 5-minute loop (`src/trigger/poll-loop.ts`) and `window: "0m"`, so the Free plan accepts them.
3. Set `pipeline.runner` to `"trigger"`. The Netlify functions then stop after the Gmail check.
4. Optional: delete the Netlify adapters to save credits.

The probe tasks and test notes from the Trigger.dev trial stay in draft PR #98.
