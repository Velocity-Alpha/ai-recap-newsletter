# 0001 — Job runner for the pipeline: Trigger.dev Free (proposed)

- **Status:** Proposed. Blocked on Trigger.dev Production deploys (see "Open").
- **Date:** 2026-11-06
- **Issue:** #46 (parent #36). Background: `docs/research/free-job-runners.md`, `docs/n8n-backend/70-migration-plan.md` §3.1.

## Context

The pipeline leaves n8n step by step. It needs a $0 runner that:
- runs repo TypeScript and Prisma 7 against Neon;
- runs AI calls of up to about 300 s;
- schedules at New York wall-clock times;
- can wait minutes at a time between polls without paying for the wait.

The plan picked Trigger.dev Free, with Inngest Free inside the Netlify app as the fallback. A one-day test decides.

## What the test showed (2026-11-06)

| Check | Result |
|---|---|
| Prisma 7 read and write on the Neon `dev` branch, Trigger.dev Dev | **Pass.** `db-smoke` read 187 issues and the latest published issue, and upserted `scraper_bookmarks.trigger_smoke_test` on `dev`. 450 ms compute. The row exists on `dev` and not on production. No Prisma build extension needed: the generated Prisma 7 client embeds its query compiler as WebAssembly and bundles as-is. |
| `wait.for` of 3 minutes or more | **Pass in Dev.** `wait-probe` waited 181.7 s. The run took 182.6 s of wall clock but 189 ms of compute, under a 60 s `maxDuration` cap. A wait does not count as compute. Production billing (`costInCents`) is still unchecked because of the deploy block. |
| Schedule in `America/New_York` | **Pass in Dev.** `ny-schedule-probe` (`45 11 * * *`, `window: "0m"`) was due at 16:45:00 UTC, which is 11:45 New York (GMT-5). It started 17 s later and ran for 18 ms. The next fires it listed are 11:45 New York on Nov 7 and Nov 8. A daylight-saving change was not tested; the next one is 2027-03-14. |
| Same task deployed to Production, reading production | **Blocked.** `trigger.dev deploy --env prod` uploads, then fails: "Deployments are not available for this organization." The dashboard gives no reason. |

## Findings that change the design

1. **Cron window.** Trigger.dev 4.8 delays each scheduled run by a stable offset of up to 60 minutes after its cron time, unless the schedule sets `window`. Every pipeline schedule must set `window: "0m"`.
2. **Security incident.** On 2026-11-01 Trigger.dev disclosed that an attacker read environment variables in 0.66% of organizations. The report says Trigger.dev then "added risk-based automated account restrictions". Our organization was created after the incident. The deploy block may be one of those restrictions. Anything stored in Trigger.dev env vars must be easy to rotate. The pipeline's database role must not be able to read `subscribers` or `auth_codes`.

## Decision (proposed)

Keep Trigger.dev Free, provided Production deploys are unblocked by 2026-11-09. Then:
- Finish the production half of this test: production read, one New York schedule fire, wait billing.
- Give the pipeline its own least-privilege Postgres role.
- Set `window: "0m"` on every schedule.

If deploys are still blocked on 2026-11-09, switch to Inngest Free inside the Netlify app. That follows the plan's rollback. Its known costs:
- every AI call must go through `step.ai.infer` or `step.fetch` to get around Netlify's 60 s limit;
- runs use the website's Netlify credits (Free plan: 300 a month, shared with production deploys at 15 each and the site's own compute).

## Open

- The owner asks Trigger.dev support why Production deploys are blocked for org `velocity-alpha-43bb`.
- After deploys work: set `DATABASE_URL` in the Trigger.dev Production environment, deploy, run `db-smoke` (read only) and `wait-probe`, and record `costInCents` here.

## Consequences

- Waits are free, so polling uses hourly schedules plus `wait.for` loops, as the plan says.
- The Dev environment runs on the laptop. Its `.env.local` must point `DATABASE_URL` at the `dev` branch. `db-smoke` refuses to write in Production, or when `DATABASE_URL` matches `PRODUCTION_DATABASE_URL`.
- The three probe tasks are temporary. Remove them once the outcome checks (#50) exist.
