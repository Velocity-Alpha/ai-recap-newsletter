# Adding a story source

How to add a news source to story ingestion. All code is in `src/pipeline/ingest/`.

## How ingestion sees a source

Every source is one entry in `STORY_SOURCES` in `src/pipeline/ingest/sources.ts`. The entry has a `key`
and a `name`. The `key` is the value stored in `stories.source` and the key of the source's bookmark in
`scraper_bookmarks`. Pick it once and keep it: a new key starts with no bookmark and no history.

`ingestStories()` in `ingest.ts` reads `STORY_SOURCES` (or `deps.sources` in tests) and runs each source
on its own. One source can fail without stopping the others. For each source it does this:

1. Reads the bookmark (`IngestStore.readBookmark`). The cutoff is the later of the bookmark and 72 hours ago.
2. Collects text newer than the cutoff.
3. Calls the extractor (`Extractor` in `extract.ts`), once per email, feed snapshot or beehiiv post.
4. Turns the stories into rows (`toRows`): cleans the URL (`cleanStoryUrl`), builds the `guid`
   (`storyGuid`), drops stories with no usable link, and checks each URL for a paywall (`checkPaywall`).
   The `guid` is only the ingestion key: it stops the same link from being inserted twice on one day. The key
   of a story everywhere else is its id (`stories.id`, ADR 0007).
5. Saves the rows (`IngestStore.upsertStories`) and moves the bookmark (`writeBookmark`).

The result is a `SourceResult` with a `documents` count (emails, feed snapshots or posts read) and a `SourceStatus`: `ok`, `no_new`, `partial` or `failed`.
`run-ingest.ts` writes one run-log line per source.

## Add an email source

Use this when the source is a newsletter that lands in the owner's Gmail.

1. Add a `GmailSource` to `STORY_SOURCES`:

   ```ts
   { key: "my_source", name: "My Source", kind: "gmail", sender: "news@example.org", body: "text", expectedOn: ["Mon", "Wed", "Fri"] }
   ```

   - `sender` is the exact From address. The Gmail query is `from:<sender> after:<cutoff>`.
   - `body` is `"text"` or `"html"`. Use `"html"` when the plain text part is poor. HTML is turned into
     text with links by `htmlToText` in `email-text.ts`.
   - `trackingLinks` is optional: a global regex for click-tracking links. `resolveTrackingLinks` in
     `redirects.ts` swaps each match for its real target before extraction. Add it when the email's links
     all go through a redirect host.
   - `expectedOn` lists the weekdays the 09:55 run gets this source's stories. The `source-empty` check
     warns only on those days. Look at the sender's emails in the inbox. An email that arrives after
     09:55 counts for the next weekday. List a day only when stories land on it almost every week. Use
     `[]` when no day is reliable.
2. Nothing else is needed. Ingestion and the checks read `STORY_SOURCES`, so the new source shows up in
   the run log and gets its own `source-empty` check.

Gmail access comes from the `GmailReader` in `src/pipeline/publish/gmail-client.ts`. The mailbox must
receive the newsletter, so subscribe it first.

## Add a feed source

Use this when the source is a web page or feed, like Product Hunt or Hugging Face.

1. Add a `FeedSource` to `sources.ts`. Its `kind` is a fixed union (`"product_hunt" | "hugging_face"`), so
   add a new kind to it. Set `expectedOn` as for a Gmail source; a daily feed uses `EVERY_WEEKDAY`.
2. In `feeds.ts`, export the feed URL and a function that builds one text block for the extractor from the
   response body. Follow `buildProductHuntText` and `buildHuggingFaceText`: they take the cutoff and the
   target date and return `{ text, count }`. Return `count: 0` when nothing is new.
3. In `ingestFeedSource` in `ingest.ts`, add the new kind to the URL choice and to the builder choice.
   Feed stories take the run's date (`fixedDay`), because feed items rarely carry a reliable date.

## Add a beehiiv site source

Use this when the source is a beehiiv publication with a public website, like In the World of AI. Pick it
over email when the mailbox is not subscribed, or when the email is only a digest. Do not add a publication
both ways. Its stories would be saved twice.

"beehiiv" is a source kind (`beehiiv_site`), never a source key. Each publication gets its own key. Old
`stories.source` values such as `beehiiv` come from n8n, and `SUBSCRIBER_PROVIDER=beehiiv` is about
subscriber lists, not sources.

1. Add a `BeehiivSiteSource` to `STORY_SOURCES`:

   ```ts
   { key: "my_source", name: "My Source", kind: "beehiiv_site", siteUrl: "https://news.example.org", expectedOn: [] }
   ```

2. Nothing else is needed. `ingestBeehiivSiteSource` in `ingest.ts` does the rest.

What it reads (`beehiiv-site.ts`):
- `{siteUrl}/sitemap.xml`. Posts are the URLs under `/p/` on the site's host (`www.` or not). A post is
  read when its `lastmod` day (UTC) is on or after the cutoff day. A sitemap with no posts fails the source.
- Each post page, newest `lastmod` first, then in sitemap order. The page cap is 30 pages per run
  (`BEEHIIV_PAGE_LIMIT`). If more posts changed, the run reads that many and records an error. New posts may be
  among the unread ones; see the [runbook](./runbook.md#a-source-error-in-an-ingest-run).
- The `Article` ld+json block gives `datePublished` and `isAccessibleForFree`. Only an explicit false
  means paid. Paid posts and posts at or before the cutoff are skipped before the body is read.
- The body is the element with id `content-blocks`. A free, new post without it is an error.
- A post dated after the run's time is an error. It would move the bookmark past every post until then.

Stories that link to the publication's own site are dropped. They count as stories without a link.

How dates work: the source date (`sourceDate`) is the New York date of the post's `datePublished`. Each
story gets its date from the extractor, with the source date as the fallback.

The bookmark moves to the last post of the unbroken run of successes from the oldest, as for emails. It
stays strictly before the first failed post's time, so a failed post that shares a time with a good one is
read again. The bookmark does not move at all in a run where a page fails to load, a page's Article data
cannot be read, or the page cap is exceeded. A post whose body is missing or whose extraction fails stops
the bookmark at the last post before it. The good posts are still saved, and the next run reads them again
harmlessly.

Why this design: [ADR 0004](../adr/0004-beehiiv-site-source.md).

## Test it

Write the test first. The tests use Vitest and fakes, not the network.

1. In `src/pipeline/ingest/ingest.test.ts`, add a test for the new source. Reuse the helpers there:
   `memoryStore` (an in-memory `IngestStore`), `fakeGmail`, `mail`, `story` and `fakeFetch`. Pass the
   source through `deps.sources` and a fake `extract` function. Check the saved rows, the `SourceResult`
   status, and that the bookmark moves only after success.
2. For a feed, add parser tests in `src/pipeline/ingest/feeds.test.ts` with a small synthetic sample.
   For tracking links, add a case in `redirects.test.ts`. For beehiiv page parsing, see
   `beehiiv-site.test.ts`.
3. Use synthetic text. Do not paste real newsletter content into the repo.
4. Run `npx vitest run src/pipeline/ingest`, then `APP_ENV=development npm run verify`.

## After it ships

- The next 10:05 check raises `source-empty:<key>:<date>` if the source gives no stories on a day in its
  `expectedOn` list. If it fires on days the sender skips by habit, take those days out. See
  [runbook.md](./runbook.md).
- To retire a source, remove its entry. Old stories keep their `source` value.
