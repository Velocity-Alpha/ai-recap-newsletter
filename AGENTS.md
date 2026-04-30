# AI Recap Newsletter Agent Guide

## Project Overview

**AI Recap Newsletter** is a high-end, editorial daily briefing platform. It delivers curated AI news.

- **Architecture**: Next.js (App Router) frontend and backend APIs.
- **Database**: Serverless Postgres via **Neon**.
- **Styling**: Tailwind CSS 4 with a custom design system based on editorial typography and "watercolor" aesthetics.
- **Deployment**: Netlify.

---

## Core Principles

1.  **Editorial Integrity**: Every UI decision and piece of copy should feel authoritative and warm, not corporate or "SaaS-y".
2.  **Zero-Downtime DB**: Prioritize safe schema changes using Neon's branching and migration best practices.
3.  **Modern Stack**: Leverage Tailwind 4 features and Next.js App Router patterns effectively.

## Coding Rules
1. Always use TDD (red, green, refactor) when implementing
2. Always use SOLID principles for clean code
