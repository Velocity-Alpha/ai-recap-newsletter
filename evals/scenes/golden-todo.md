# Work list: golden values of the scene evals

Both scene evals (`evals/scene-prompt`, `evals/scene-ideas`) grade each scene against one golden value per issue:
which Top Story is the lead, and what a scene of it should show. You (Claude Opus) make them, one issue at a time,
into `evals/scenes/golden.json`. The text is our own (subject lines, headlines, story detail), so the file is
committed.

## Inputs

Run `npm run eval:build -- evals/scenes/golden-inputs.ts` first. It writes one file per issue to
`evals/data/scenes/golden-inputs/<itemId>.json` (100 files, gitignored):

```json
{ "itemId": "2026-10-27", "inputHash": "12ee0c3a62f1dab2", "input": { "subjectLine": "...", "topStories": [{ "headline": "...", "detail": "..." }] }, "numberedHeadlines": ["1. ...", "2. ..."] }
```

Read only that file for an issue. Do not look at other issues, the database, or the web.

## The value

```ts
interface SceneGolden {
  lead_story: number;            // 1-based number of the top story the subject line is about
  identifiers: string[];         // 1 to 4 concrete identifiers of the lead story's news a scene should show
  forbidden_misreads?: string[]; // optional: readings a scene must not show
}
```

### lead_story

The app's scene context tells the model (`SCENE_CONTEXT_FOCUS` in `src/pipeline/draft/image/scene-prompt.ts`):

> Important: Focus on the main topic from the subject line of the email

So the lead is the top story the subject line is about. The subject line was written about the lead story; match
its company, product or event to one headline and its detail. When the subject line names a company that has two
top stories, choose the one whose news the subject line's words describe. Every issue has a lead: never 0. If two
stories fit equally, choose the first and add the other's main subject to `forbidden_misreads`.

### identifiers

1 to 4 short noun phrases, each a thing a scene can show, from the lead story's headline and detail: the company
(shown as its mark), the product or model by name, or the physical object central to the news (for example a
trading floor's listing bell for an IPO, a GPU rack for a compute deal). Order them by how strongly they identify
this story; 2 or 3 is usual. They follow the app's scene rules (imported in the prompts; quoted here):

> Include only a small number of grounding identifiers.

> Logos/brand elements can be explicitly mentioned when needed instead of simulating them.

> If a logo or readable brand mark is needed, include only one, printed on a physical object in the scene, small and natural.

> Avoid scenes that require reading screens, dashboards, paragraphs, multiple labels, code, or UI.

So an identifier is never: an abstract idea ("AI safety", "the future of work"), a number or text a viewer would
have to read (a price, a benchmark score, a ticker on a screen), a screen or interface, or a generic AI symbol (a
robot, a glowing brain, a chip with no maker). A company counts once, as itself; do not list a company and its mark
separately. Use the names as the story writes them.

### forbidden_misreads (optional)

Add 1 to 3 only when a scene could plausibly show the wrong thing: another top story's company or product, a
same-named thing (Gemini the constellation for Google Gemini), or the opposite of the news (a crash for a funding
round). Leave the field out when there is no likely misread.

## Writing entries

`evals/scenes/golden.json` has the shape `{ about, producer: "claude-opus-5-5", entries }`. Add one entry per issue,
keyed by `itemId`:

```json
"2026-10-27": { "inputHash": "<the input file's inputHash>", "date": "<today, YYYY-MM-DD>", "value": { "lead_story": 1, "identifiers": ["Anthropic", "Nasdaq listing bell"] } }
```

- `inputHash` is `hashInput(input)` from `evals/lib/golden.ts`; the input file already holds it. Copy it, do not
  compute it by hand. If an issue changes (a rebuild of `evals/scenes/issues.json`), its hash changes and the evals
  refuse the old entry: make it again.
- Keep the entries sorted by `itemId`. Leave the other fields of the file as they are.
- Work in batches of 10 to 20 issues; after each batch, check that the file parses.

## Check

When every issue has an entry, run `npx vitest run evals/scenes` (the shape checks) and, with no API calls,
confirm that the evals would start: `readSceneGolden` in `evals/scenes/golden.ts` throws on any missing, stale, or
malformed entry (a `lead_story` that is not a top story, or not 1 to 4 non-empty identifiers).
