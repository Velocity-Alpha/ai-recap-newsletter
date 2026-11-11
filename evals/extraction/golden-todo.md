# Story extraction: golden work list

For a Claude Opus agent. One golden value per issue of `evals/extraction/manifest.json` (58 issues). The values go
in `evals/extraction/golden.json`, which is committed: labels in our own words and public URLs only, never the
newsletter's text, headlines or sentences.

## Before you start

1. Build the issue text if `evals/data/extraction/dataset.json` is missing:
   `npm run eval:build -- evals/extraction/build-dataset.ts` (with `DATABASE_URL` for the Neon `dev` branch).
2. Run `npm run eval:build -- evals/extraction/golden-inputs.ts`. It writes
   `evals/data/extraction/golden-inputs/<issueId>.json` for each issue and `_rules.md`, then lists the issues
   still to do and any problem with the entries.
3. Read `evals/data/extraction/golden-inputs/_rules.md`. It holds the extraction prompt's own rules: what is not
   qualifying, the summary rules, the URL rules, the category rules and the importance rubric, taken from
   `src/pipeline/ingest/extract.ts`. Follow them exactly. Do not take rules from anywhere else, and do not copy
   them into this file.

## For each issue

Work issue by issue. Skip an issue that already has an entry whose `inputHash` equals the one in its input file.

1. Open `golden-inputs/<issueId>.json`. The issue is `input.text`; `input.sourceDate` is its date. `source` and
   `issueUrl` say which newsletter it is.
2. Read the whole text, top to bottom, and list every distinct item: each story with its own headline, or its own
   sentence or paragraph with a named event. Each item of a "quick links", "everything else" or similar list is
   its own story.
3. Sort each item:
   - It matches the "not qualifying" list of `_rules.md`: it goes in `excluded`.
   - A list of tools or resources under one heading (for example "trending tools"): one golden story with
     `roundup: true` and `url: ""`, whose category and importance are those of the list as a whole.
   - Otherwise it is a qualifying story: it goes in `stories`.
   Leave out the masthead, the table of contents, the issue's intro and sign-off, and page boilerplate: they are
   neither stories nor `excluded` items. Do put in `excluded` each block an extractor could mistake for a story:
   a sponsor block, a lead magnet, a newsletter promotion or referral, a recurring section with no news, a
   negative-news item.
4. For each story:
   - `label`: what happened, in at most 10 words of your own. Not the newsletter's headline, not a quote.
   - `url`: by the URL rules of `_rules.md`, copied exactly as the link appears in the text (a story with one clear
     source link gets that link; prefer the original source over the newsletter's own permalink). `""` for a
     roundup or a story with several links, and `""` when the text gives no link.
   - `category`: apply the category rules of `_rules.md` in order and take the first that matches. Write the category's name exactly as the
     rules give it (the names are `STORY_CATEGORIES` in `src/pipeline/ingest/extract.ts`).
   - `importance`: an integer 1 to 5 by the importance rubric of `_rules.md`, the first level that fully matches.
   Judge from the text only. Do not look things up.
5. For each excluded item: `label` (at most 10 words, your own) and `reason`, the rule it matches in a few words:
   `sponsored`, `sponsored event`, `sponsored link`, `lead magnet`, `newsletter promotion`, `recurring section`,
   or `negative news`.
6. Keep the stories in the order they appear in the text.

## Writing an entry

Add the entry under `entries` in `evals/extraction/golden.json`, keyed by the issue id:

```json
"tldr-2026-10-08": {
  "inputHash": "<the inputHash of golden-inputs/tldr-2026-10-08.json>",
  "date": "YYYY-MM-DD",
  "value": {
    "stories": [
      { "label": "Acme releases its first open model", "url": "https://acme.example/blog/model", "category": "Launches", "importance": 4 },
      { "label": "Trending tools list", "url": "", "category": "Tools", "importance": 2, "roundup": true }
    ],
    "excluded": [{ "label": "Sponsor block for a coding agent", "reason": "sponsored" }]
  }
}
```

- `inputHash` is `hashInput(input)` (`evals/lib/golden.ts`) of the issue's input `{ sourceDate, text }`; the input
  file already holds it. Copy it.
- `date` is the day you made the value.
- Leave `roundup` out unless it is `true`.
- Keep the file valid JSON. Do not change other entries or the `about` and `producer` fields.

## Check your entries

Run `npx vitest run evals/extraction/golden.test.ts` and `npm run eval:build -- evals/extraction/golden-inputs.ts`.
They fail on, or list, an entry with a stale `inputHash`, a wrong shape, a label over 10 words, a category or
importance the rules do not allow, a roundup with a url, or a url that is not a link in the issue text. Fix each
entry they name.
