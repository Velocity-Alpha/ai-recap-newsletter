# AI Recap Newsletter Agent Guide

This file loads in every conversation. Keep it short: rules that always apply go here, everything else goes in
a doc listed under "Read when needed".

## Product

- AI Recap is an automated weekday AI newsletter.
- Reliability comes first: subscriber access, issue rendering, and API behavior must stay stable.
- It should feel like a high-end editorial daily briefing: authoritative and warm, not corporate or SaaS-y.

## System

- One repo: a Next.js App Router site on Netlify, plus the pipeline jobs (ingest, draft, publish detection,
  checks) as Netlify functions. Job logic is in `src/pipeline/`; `netlify/functions/` holds thin wrappers.
  Code they import must not import `next/*`: functions do not ship `next` and fail to load.
- Data: Postgres on Neon through Prisma. Tests: Vitest. Styling: Tailwind CSS 4.
- The owner sends each issue by hand in GoHighLevel (GHL). GHL emails the subscribers. Subscriber records
  live in both this app and GHL.
- n8n is retired. Never call or change it.

## Rules

- Use test-driven development. Update tests when behavior changes.
- Read the code path before you change it. Keep changes small.
- A change is done only when its automated checks pass. If you cannot run a check, say so in the handoff.
- Run `APP_ENV=development npm run verify` (lint, tests, build) before every push.
- Never run tests or jobs against the production database. Use the Neon `dev` branch.
- Do not run `npm run prisma:migrate:prod:deploy` without the owner. Apply each migration to `dev` first.
- The repo is public: no secrets, subscriber data, or open security details in code, docs, or issues.
- Use the words in `GLOSSARY.md`.

## Commands

- `npx vitest run <path>` runs some tests. `npm test` runs all.
- `npm run db:reset-dev` resets the Neon `dev` branch. `npm run prisma:migrate:status` shows migration state.

## Docs

- When jobs, services, data, or env vars change, update `docs/architecture.html` in the same PR.
- Describe the system as it is now. Replace old text; do not append to it. Leave history to git and ADRs.

## Read when needed

| Read | When |
|---|---|
| [docs/architecture.html](./docs/architecture.html) | Before work on the pipeline, jobs, data, or services |
| [GLOSSARY.md](./GLOSSARY.md) | Before you name something |
| [README.md](./README.md) | Setup, env vars, migrations, deploy, API routes |
| [docs/pipeline/runbook.md](./docs/pipeline/runbook.md) | An incident or alert |
| [docs/pipeline/adding-a-source.md](./docs/pipeline/adding-a-source.md) | Adding a news source |
| [docs/adr/](./docs/adr/) | Before you change a past decision |
| [docs/n8n-backend/](./docs/n8n-backend/), [docs/research/](./docs/research/) | History only: the old n8n system and past research. Not the current system |

## Agent skills

- **Issue tracker:** GitHub Issues for `Velocity-Alpha/ai-recap-newsletter`, with the `gh` CLI. See
  `docs/agents/issue-tracker.md`.
- **Triage labels:** `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See
  `docs/agents/triage-labels.md`.
- **Domain docs:** one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
