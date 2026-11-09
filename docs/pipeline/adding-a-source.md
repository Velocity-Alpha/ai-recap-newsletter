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
3. Calls the extractor (`Extractor` in `extract.ts`), once per email or feed snapshot.
4. Turns the stories into rows (`toRows`): cleans the URL (`cleanStoryUrl`), builds the `guid`
   (`storyGuid`), drops stories with no usable link, and checks each URL for a paywall (`checkPaywall`).
5. Saves the rows (`IngestStore.upsertStories`) and moves the bookmark (`writeBookmark`).

The result is a `SourceResult` with a `SourceStatus`: `ok`, `no_new`, `partial` or `failed`.
`run-ingest.ts` writes one run-log line per source.

## Add an email source

Use this when the source is a newsletter that lands in the owner's Gmail.

1. Add a `GmailSource` to `STORY_SOURCES`:

   ```ts
   { key: "my_source", name: "My Source", kind: "gmail", sender: "news@example.org", body: "text" }
   ```

   - `sender` is the exact From address. The Gmail query is `from:<sender> after:<cutoff>`.
   - `body` is `"text"` or `"html"`. Use `"html"` when the plain text part is poor. HTML is turned into
     text with links by `htmlToText` in `email-text.ts`.
   - `trackingLinks` is optional: a global regex for click-tracking links. `resolveTrackingLinks` in
     `redirects.ts` swaps each match for its real target before extraction. Add it when the email's links
     all go through a redirect host.
2. Nothing else is needed. Ingestion and the checks read `STORY_SOURCES`, so the new source shows up in
   the run log and gets its own `source-empty` check.

Gmail access comes from the `GmailReader` in `src/pipeline/publish/gmail-client.ts`. The mailbox must
receive the newsletter, so subscribe it first.

## Add a feed source

Use this when the source is a web page or feed, like Product Hunt or Hugging Face.

1. Add a `FeedSource` to `sources.ts`. Its `kind` is a fixed union (`"product_hunt" | "hugging_face"`), so
   add a new kind to it.
2. In `feeds.ts`, export the feed URL and a function that builds one text block for the extractor from the
   response body. Follow `buildProductHuntText` and `buildHuggingFaceText`: they take the cutoff and the
   target date and return `{ text, count }`. Return `count: 0` when nothing is new.
3. In `ingestFeedSource` in `ingest.ts`, add the new kind to the URL choice and to the builder choice.
   Feed stories take the run's date (`fixedDay`), because feed items rarely carry a reliable date.

## Test it

Write the test first. The tests use Vitest and fakes, not the network.

1. In `src/pipeline/ingest/ingest.test.ts`, add a test for the new source. Reuse the helpers there:
   `memoryStore` (an in-memory `IngestStore`), `fakeGmail`, `mail`, `story` and `fakeFetch`. Pass the
   source through `deps.sources` and a fake `extract` function. Check the saved rows, the `SourceResult`
   status, and that the bookmark moves only after success.
2. For a feed, add parser tests in `src/pipeline/ingest/feeds.test.ts` with a small synthetic sample.
   For tracking links, add a case in `redirects.test.ts`.
3. Use synthetic text. Do not paste real newsletter content into the repo.
4. Run `npx vitest run src/pipeline/ingest`, then `APP_ENV=development npm run verify`.

## After it ships

- The next 10:05 check raises `source-empty:<key>:<date>` if the source sends nothing on a day it usually
  sends. A new source has no history, so every weekday counts until it builds some. See
  [runbook.md](./runbook.md).
- To retire a source, remove its entry. Old stories keep their `source` value.
