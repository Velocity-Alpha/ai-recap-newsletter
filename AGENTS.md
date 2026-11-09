# AI Recap Newsletter Agent Guide

## Product

- AI Recap is an automated AI newsletter product.
- The goal is operational reliability first: subscriber access, issue rendering, and API behavior should stay stable.
- The product should feel like a high-end editorial daily briefing: authoritative and warm, not corporate or SaaS-y.

## System Context

- Content + publishing website: Next.js App Router app in this repo.
- Automation/ops pipeline: story ingestion, drafting, and publish detection run as Netlify functions in this repo
  (`src/pipeline/`, `netlify/functions/`). n8n owns no stage since 2026-11-09; its workflows stay for rollback. See
  [docs/architecture.html](./docs/architecture.html).
- Newsletter subscription source of truth is split across this app and external automations like GHL.
- GHL sends the actual emails.

## Stack

- Next.js 16
- React 18
- TypeScript
- Postgres on Neon via Prisma
- Tailwind CSS 4
- Vitest
- ESLint
- Netlify deployment

## Coding Rules

- Use test-driven development by default.
- Follow SOLID principles where they improve clarity and maintainability.
- Do not mark a feature/fix as done until it is fully verified with the relevant automated checks.
- Prefer targeted tests while iterating, then broader verification when the scope justifies it.
- If you cannot run a needed check, say so explicitly in the handoff.

## Workflow Expectations

- Read the relevant code paths before making assumptions.
- Keep changes small and coherent.
- Add brief comments only where the intent would otherwise be easy to misread.
- Update tests when behavior changes.
- Prioritize safe schema changes using Neon's branching and migration best practices.
- Use modern Tailwind 4 and Next.js App Router patterns.

## Key References

- Read first: current and target architecture (stage owners, daily flow, jobs, services, data, env vars,
  what n8n still does). Update it in the same PR when any of these change:
  [docs/architecture.html](./docs/architecture.html)
- README for setup, env vars, deploy, and API inventory:
  [README.md](./README.md)
- Prisma schema:
  [prisma/schema.prisma](./prisma/schema.prisma)

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `Velocity-Alpha/ai-recap-newsletter`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created when needed. See `docs/agents/domain.md`.

## Pipeline

The pipeline jobs (ingest, checks, drafting, publish detection) run as Netlify functions, not npm scripts.
Run and test them with these commands:

- `npx vitest run src/pipeline` runs the pipeline tests. `npm test` runs all tests.
- `APP_ENV=development npm run verify` runs lint, tests and build. Run it before every push.
- `npm run db:reset-dev` resets the Neon `dev` branch. `npm run prisma:migrate:status` shows migration state.
- `npm run prisma:migrate:deploy` applies migrations to the database in `DATABASE_URL`;
  `npm run prisma:migrate:prod:deploy` applies them to production. Do not run the production one without the owner.

References:

- [docs/architecture.html](./docs/architecture.html): stages, jobs, data, env vars.
- [GLOSSARY.md](./GLOSSARY.md): the project's words.
- [docs/adr/](./docs/adr/): decisions.
- [docs/pipeline/runbook.md](./docs/pipeline/runbook.md): what each incident means and what to do.
- [docs/pipeline/adding-a-source.md](./docs/pipeline/adding-a-source.md): how to add a news source.
