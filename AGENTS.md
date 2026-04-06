## Product

- AI Recap is an automated AI newsletter product.
- The goal is operational reliability first: subscriber access, issue rendering, and API behavior should stay stable.

## System Context

- Content + publishing website: Next.js App Router app in this repo.
- Automation/ops pipeline: n8n handles ingestion and the HITL workflow outside this repo.
- Newsletter subscription source of truth is split across this app and external automations like GHL.
- GHL sends the actual emails

## Stack

- Next.js 16
- React 18
- TypeScript
- Postgres on Neon via Prisma
- Vitest
- ESLint
- Netlify deployment

## Coding Rules

- Use test-driven development by default.
- Do not mark a feature/fix as done until it is fully verified (running the relevant automated checks, not just reading the code.)
- Prefer targeted tests while iterating, then broader verification when the scope justifies it.
- If you cannot run a needed check, say so explicitly in the handoff.

## Workflow Expectations

- Read the relevant code paths before making assumptions.
- Keep changes small and coherent.
- Add brief comments only where the intent would otherwise be easy to misread.
- Update tests when behavior changes.

## Key References

- README for setup, env vars, deploy, and API inventory:
  [README.md](./README.md)
- Prisma schema:
  [prisma/schema.prisma](./prisma/schema.prisma)