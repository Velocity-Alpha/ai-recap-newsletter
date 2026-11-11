# Free links: golden work list

For a Claude Opus agent with web search and web fetch. One golden value per story of `evals/free-links/stories.json`
(100 paywalled stories). The values go in `evals/free-links/golden.json`, which is committed: story ids and public
URLs only, never article text.

## Before you start

1. Run `npm run eval:build -- evals/free-links/golden-inputs.ts` (with `DATABASE_URL` for the Neon `dev` branch,
   so the learned paywalled sites are listed). It writes `evals/data/free-links/golden-inputs/<storyId>.json` for
   each story and `_rules.md`.
2. Read `evals/data/free-links/golden-inputs/_rules.md`. It holds every rule below, in the app's own words: the
   search prompt's ask, what the eval's judge calls the same news, and the app's check of a link. Follow it
   exactly. Do not take rules from anywhere else, and do not copy them into this file.

## For each story

Work item by item. Skip a story that already has an entry whose `inputHash` equals the one in its input file.

1. Open `golden-inputs/<storyId>.json`. The story is `input`: `headline`, `summary` (our own text) and `url` (the
   paywalled link).
2. Search the web for articles that report the story's news. Try at least three queries: the headline's key
   names and numbers, the company or person with the event, and the primary source (a company post, a filing, a
   court document). Look for news coverage published within a few days of the event.
3. For each candidate, fetch the page and read it. Keep it only when all of these hold (see `_rules.md`):
   - the page is the article itself, free to read, with no login or subscribe wall, and its article text has at
     least the word count in `_rules.md`;
   - you would answer "same" for it by the judge's definitions in `_rules.md`, not "related";
   - its site passes the app's check in `_rules.md` (not the story's own site, not a skipped site, not a
     paywalled or learned paywalled site).
4. Keep at most the number of links in `_rules.md`, best first: the primary source or the original reporting
   before rewrites. Use the URL of the article page, without tracking query strings.
5. If after a real search no candidate passes, the story has no free source: `free_source_exists` is `false` and
   `urls` is `[]`. Do not lower the bar to fill the list.

## Writing an entry

Add the entry under `entries` in `evals/free-links/golden.json`, keyed by the story id as a string:

```json
"10342": {
  "inputHash": "<the inputHash of golden-inputs/10342.json>",
  "date": "YYYY-MM-DD",
  "value": { "free_source_exists": true, "urls": ["https://...", "https://..."] }
}
```

- `inputHash` is `hashInput(input)` (`evals/lib/golden.ts`); the input file already holds it. Copy it.
- `date` is the day you read the pages.
- `free_source_exists` is `true` exactly when `urls` is not empty.
- Keep the file valid JSON. Do not change other entries or the `about` and `producer` fields.

## Check your entries

Run `npx vitest run evals/free-links/golden.test.ts`. It fails on an entry with a stale `inputHash`, a wrong
shape, too many URLs, or a URL the app's check would drop before reading (own site, skipped site, built-in
paywalled site). Fix each entry it names. Learned paywalled sites are not in that test: check them against
`_rules.md` yourself.
