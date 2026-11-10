# 0003 — Read beehiiv publications from their website

- **Status:** Accepted, 2026-11-10.
- **Background:** `docs/n8n-backend/15-legacy-and-experiments.md`, `docs/pipeline/adding-a-source.md`.

## Context

We want stories from In the World of AI. The mailbox does not get it, so the email source cannot read it.
It is a beehiiv publication with a public website.

n8n had a "Scrape Beehiiv" workflow. We dropped it. It used CSS selectors tied to the page layout. It read
only the first page of posts. It dated posts by their position on the page, and only to midnight. It needed
Jina Reader. Its source was hardcoded. `15-legacy-and-experiments.md` advises not to port per-source
scrapers.

## Decision

Add one generic source type, `beehiiv_site`. A new beehiiv publication is one entry in `STORY_SOURCES`.
It uses only stable, standard parts of the site:
- `sitemap.xml` lists the posts. Its `lastmod` day picks the recent ones.
- The schema.org `Article` data (`ld+json`) on each post gives `datePublished` and `isAccessibleForFree`.
- The element with id `content-blocks` holds the post body.

A post's metadata is read first. Paid posts and posts at or before the bookmark are skipped before the
body is needed. The run reads at most 30 post pages, newest first, and records an error when there are
more. If any page fails, or the cap is hit, the bookmark stays where it is. A failed page has no known
date, so it cannot be placed in the bookmark order.

Stories that link to the publication's own site are dropped. They point at the newsletter, not the news.

"beehiiv" is a source kind (`beehiiv_site`), never a source key. Each publication gets its own key. Old
`stories.source` values `beehiiv` and `beehiiv_ai_breakfast` are from n8n. `SUBSCRIBER_PROVIDER=beehiiv`
is about subscriber lists and is unrelated.

It does not use beehiiv's internal page data (`window.__remixContext`). It fails loudly when a part is
missing. It needs no new service.

## Consequences

- One layout dependency remains: `#content-blocks`. If beehiiv renames it, the source fails with a clear
  error and the run log shows it.
- When a publisher turns on the public RSS feed, that feed would be a fine alternative.
- One failing page holds the bookmark for the whole source. The good posts are saved again on the next
  run; the upsert makes that harmless.
- `curation.service.ts` still hides stories whose URL contains "tldr", "rundown" or "beehiiv". It covers
  old rows. The own-site drop at ingest could replace it later.
- Publications already read by email stay on email. Reading one both ways would save its stories twice.
