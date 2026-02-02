# AI Recap Newsletter Agent Guide

## Project Overview

**AI Recap Newsletter** is a high-end, editorial daily briefing platform. It delivers curated AI news with an aesthetic inspired by *Monocle* and *Morning Brew*.

- **Architecture**: Next.js (App Router) frontend, Netlify Functions backend.
- **Database**: Serverless Postgres via **Neon**.
- **Styling**: Tailwind CSS 4 with a custom design system based on editorial typography and "watercolor" aesthetics.
- **Deployment**: Netlify.

---

## Skills Usage

When performing tasks, reference the specialized guidelines in `.agents/skills/`:

### [Design Skill](skills/design/SKILL.md)
**Use when**: 
- Creating or modified UI components.
- Styling pages or implementing new layouts.
- Adjusting design tokens (colors, typography, spacing).
- Ensuring adherence to the "Editorial, not startup" philosophy.

### [Neon Postgres Skill](skills/neon-postgres/SKILL.md)
**Use when**:
- Working with database schemas or migrations in `infrastructure/db`.
- Implementing data fetching logic using `@neondatabase/serverless`.
- Automating database workflows via the Neon CLI.
- Managing Neon project resources or branching strategies.

---

## Core Principles

1.  **Editorial Integrity**: Every UI decision and piece of copy should feel authoritative and warm, not corporate or "SaaS-y".
2.  **Zero-Downtime DB**: Prioritize safe schema changes using Neon's branching and migration best practices.
3.  **Modern Stack**: Leverage Tailwind 4 features and Next.js App Router patterns effectively.
