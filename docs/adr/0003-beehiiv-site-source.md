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
body is needed. A post dated in the future is a failed page. The run reads post pages up to the page cap,
newest `lastmod` first, then in sitemap order. When more posts changed, it records one error and says new
posts may be unread (see the runbook). If any page fails, or the cap is exceeded, the bookmark stays where
it is. A failed page has no known date, so it cannot be placed in the bookmark order.

For every source kind, the bookmark stays strictly before the first failed document's time. A document
that shares a time with an earlier success is then read again.

Run counts are `documents`: emails, feed snapshots or posts read.

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
- `lastmod` is a day, so when many posts are edited at once the page cap can hide a new post. We cannot tell
  which are new without reading them. The error says so, and the runbook says what to do.
- Publications already read by email stay on email. Reading one both ways would save its stories twice.
