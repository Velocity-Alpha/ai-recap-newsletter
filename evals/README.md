# Evals

Evals run the app's real model calls on fixed test sets and score the answers. Use them to pick the
reasoning effort of each call, and to check a new model before the app moves to it. They call OpenAI and cost
money, so `npm test` never runs them.

## Current choices

Each effort was set on a full sweep over the test sets below. Text is graded by a `gpt-6.1-terra` judge on the
flex tier, mostly against golden values made by Claude Opus (see [Golden values](#golden-values)). A range is the
95% interval of the difference against the production effort (see [Results](#results)).

| Call | Effort | Why | Results |
|---|---|---|---|
| Story extraction (`src/pipeline/ingest/extract.ts`) | medium | 58 issues × 2. Low finds fewer golden stories (recall −6 pts, −8 to −3), puts fewer in the golden category (−5 pts, −7 to −2) and misses 2.75 per issue against 1.97. High is no better on any metric, and its p95 is 105 s of the 120 s timeout. | [extraction.md](results/extraction.md) |
| Lead pick (`src/features/newsletter/openai-lead-pick.ts`) | low | 11 boards × 3. The AI lead is the owner's lead in 22 of 33 runs at low, against 18 of 33 at none, medium and high. Only 11 boards have a lead the owner committed, so this is weak evidence; low is the cheapest effort that is not worse. | [lead-pick.md](results/lead-pick.md) |
| Repeat check (`src/pipeline/repeats/`, Decisions API) | n/a | The Decisions API takes no effort. 303 pairs (60 with golden labels): same news → sure in 100 of 145, sure or similar in 140 of 145; different → sure in 0 of 129. | [repeats.md](results/repeats.md) |
| Issue writer (`src/pipeline/draft/writer.ts`) | high | 30 issues × 2. Notes followed (judge) 176 of 180, against 165 at medium (−6 pts, −11 to −2) and 138 at low. Wins against the Opus reference issue 40 of 60, against 32 at medium (−13 pts, −30 to +3) and 25 at low (−25 pts, −42 to −8). About 1 unsupported claim per issue at every effort. 0.42 cents a call against 0.28; p95 70 s of the 240 s timeout. | [writer.md](results/writer.md) |
| Scene prompt (`src/pipeline/draft/image/scene-prompt.ts`) | high | 100 issues × 2. All hard rules in 184 of 200 runs against 156 at medium (+14 pts, +7 to +21), no extras in 200 of 200 against 193; lead depicted and lead identifiers level. Low is worse on hard rules (−17 pts, −24 to −9). 0.14 cents a call against 0.08; p95 44 s of the 120 s timeout, in a background step. | [scene-prompt.md](results/scene-prompt.md) |
| Scene ideas (`src/pipeline/draft/image/scene-ideas.ts`) | medium | 100 issues × 2. Low is worse on no extras (−22 pts, −29 to −16), clearly different ideas (−12 pts, −19 to −7) and a lead identifier shown (−13 pts, −20 to −6). High has more ideas with no extras (+12 pts), but 17 of its 200 calls failed the 45 s timeout of the web request (p95 43.5 s). | [scene-ideas.md](results/scene-ideas.md) |
| Free-link search (`src/pipeline/free-links/search.ts`) | low | 100 stories × 1. A usable link where the golden value has one for 69 of 94 at low and medium; stories with a usable link 71 against 70 (+1 pt, −9 to +11); kept links that report the same news 87% against 88% (−1 pt, −6 to +6). 2.3 cents a story against 3.4; p95 18.5 s against 29.7 s of the 120 s limit. More paywalled or too-short links, which the page check drops before saving. | [free-links.md](results/free-links.md) |

The code comment at each effort constant gives the evidence it was set on. Change the constant and its comment
together, from a results file.

## Run

Every eval needs `OPENAI_API_KEY`. Never point `DATABASE_URL` at production: evals only read the Neon `dev`
branch, in read-only transactions.

```sh
npm run eval -- evals/lead-pick                       # one eval, with its default sweep
npm run eval                                          # every eval
EVAL_EFFORTS=low,high npm run eval -- evals/lead-pick # a sweep you choose
EVAL_LIMIT=2 EVAL_REPEATS=1 npm run eval -- evals/lead-pick # a quick run
npm run eval:build -- evals/scenes/build-issues.ts    # rebuild a test set (scripts that are not evals)
npm run eval:rerender -- writer free-links            # rebuild results files from their stored rows, no API calls
```

| Variable | Meaning | Default |
|---|---|---|
| `EVAL_MODEL` | The model to run | the call site's model |
| `EVAL_EFFORTS` | Comma list of `none`, `low`, `medium`, `high`, `xhigh`, `max`, or `default`: the eval drops the call's `reasoning` field, so the API's own default applies (every production call sets its effort) | each eval's sweep |
| `EVAL_REPEATS` | Runs of each item, to see the noise | each eval's |
| `EVAL_LIMIT` | Only the first N items | all |
| `EVAL_CONCURRENCY` | Item runs in flight at once, over all configs of the sweep | 24 (or the eval's) |
| `EVAL_JUDGE_MODEL`, `EVAL_JUDGE_EFFORT` | The judge, for evals that grade text | `gpt-6.1-terra`, `medium` |
| `EVAL_JUDGE_TIER` | `flex` or `standard`: the tier of judge calls and shared work | `flex` |
| `EVAL_JUDGE_CONCURRENCY` | Grades, and judge calls, in flight at once | 24 |
| `EVAL_JUDGE_REPEATS` | Grade only the first N repeats of each item, to save judge cost | every repeat |
| `EVAL_RATE_SHARE` | The share of our OpenAI rate limits evals may use, leaving room for production jobs | 0.8 |

gpt-6-luna takes the efforts above and uses `medium` when none is sent
([model page](https://developers.openai.com/api/docs/models/gpt-6-luna)). The Decisions API (repeat check) takes
no effort and only `gpt-6-luna`, so its sweep is over `EVAL_MODEL` alone and `EVAL_EFFORTS` is refused.

How a sweep runs (`evals/lib/sweep.ts`, `evals/lib/rate-limit.ts`):

- Every config runs at the same time, under the one `EVAL_CONCURRENCY` cap. Results keep the sweep's order.
- The call under test always runs on the standard tier: its latency is a metric, and its timeouts mirror
  production. The judge and shared work run on flex (half price, slower, 15-minute timeout). When flex has no
  capacity (a 429 "resource unavailable"), the call backs off three times with jitter, then goes on standard.
  Cost uses the tier each answer reports.
- One limiter per model, for the whole process, keeps requests and tokens per minute under `RATE_LIMITS` (our
  limits, from the API's headers) times `EVAL_RATE_SHARE`. It takes each request's estimated tokens before the
  call and corrects them from its usage after.
- A rate-limit 429 is retried after the wait the API asks for, so it is never a model error, and the wait is not
  in the latency. A spent quota is not retried. We do not use the Batch API: flex gives the same discount and
  answers in minutes, not hours.

## Results

A run writes `evals/results/<task>.md`: one row for each model and effort. It replaces the rows of the configs
it ran and keeps the others. Commit it. The rows are also stored as JSON at the end of the file, so
`npm run eval:rerender` can rebuild the table after a change to how results are shown. The raw run (each item's
ids, numbers, usage, call times and grade status) goes to `evals/out/<task>.json`, which git ignores.

The columns, after the eval's metrics:

- A count shows `hits/n (percent)`. With two or more repeats, each metric also shows the lowest and highest
  repeat in brackets, so the noise is visible: `21/30 (70%; 60–80%)`, or `7.4 (6.9–8.1)` for a number.
- The baseline is the call site's production effort; its row says `(baseline)`, and it always runs. Each count of
  every other row adds its difference against the baseline row of the same run, with a 95% confidence interval:
  `21/30 (70%), +6 pts (−2 to +14)`. The interval is a paired bootstrap (2,000 resamples, fixed seed) that
  resamples items, each with all its repeats, so it shows how much of the gap is the test set's noise. An interval
  that spans 0 is no evidence of a difference. A count that does not add up item by item gets no difference.
  The difference is stored in the row's JSON.
- `Errors`: runs whose call threw. An error is a miss in every count of the run.
- `Graded`: runs the judge graded, of the runs it tried. Judged counts are over the graded runs.
- `p50`, `p95`: the time of the model calls of one run, without rate-limit waits. Grading is not timed.
- `Searches per call`: web search calls per run, for calls with the web search tool.
- `Cost per call`: tokens at the prices in `evals/lib/usage.ts`, plus $0.01 per web search call. A model with no
  price there shows `unknown`: add it first.
- `Judge`: the judge's model and effort for that row, so rows judged at different efforts say so.
- `Judge cost per call`: the judge's cost spread over the runs, at the tier each answer reports (flex is half).
- A line under the table gives the cost of shared work (see below), which is in neither cost column.

A column with no value in any row is left out. An eval can choose its metric columns (the writer does); every
metric stays in the stored rows. Rows run on a different test set are not comparable: when a test set changes,
drop the old rows from the stored JSON and run `npm run eval:rerender`.

## Data, and the rule on third-party text

The repo is public. Results files hold metrics, story ids and our own headlines only, never article or
newsletter text. Test sets already in the repo (`src/**/__fixtures__/`) can be used as they are. A test set of our
own text (subject lines, headlines, story detail, summaries) is committed, so a reset of the Neon `dev` branch
does not change it: `evals/scenes/issues.json` (both scene evals) and `evals/lead-pick/summaries.json`. A test set
that needs third-party text goes in `evals/data/` (git ignores it). Build scripts in the eval's folder make both
kinds from the Neon `dev` branch (read-only, `evals/lib/dev-db.ts`) or public pages, run with
`npm run eval:build`. Each eval's notes say where its data came from.

## Golden values

A golden value is the answer a stronger model than the one under test gave for an item; here Claude Opus, run
from Claude Code. The judge compares each output to it. Extraction, free links, the scene evals and the writer
have golden values; the repeat check has them for its 60 new pairs; the lead pick scores against the owner's own lead
instead. A judge may favour its own family's style: GPT-6 Luna drafts beat the Opus reference issue 40 of 60 times,
so the writer's win rate compares efforts and models, and is not an absolute quality score. A golden file is JSON:
`{ "about", "producer" (e.g. "claude-opus-5-5"), "entries": { <item id>: { "inputHash", "date", "value" } } }`.
It lives at `evals/<task>/golden.json` (committed), or at `evals/data/<task>/golden.json` (git ignores it) when
the values come from third-party text.

`evals/lib/golden.ts`: `loadGolden(path)` reads a file; `goldenFor(golden, itemId, input)` gives an item's value,
and throws, naming the item, when it has no entry or its `inputHash` is not `hashInput(input)` (the item changed);
`missingGolden(golden, items)` lists the items to make or regenerate. When an item changes, regenerate its entry.

## Add an eval

Add a folder; there is no list to edit.

```
evals/<task>/
  <task>.eval.ts   the run: settings, items, runSweep (only file that calls a model)
  score.ts         pure scoring: (outcomes) => Metric[]
  score.test.ts    unit tests for score.ts; npm test runs them, with no network
```

The contract, from `evals/lib/`:

1. The call site takes optional `model` and `effort` (and a `client` or `fetch`), defaulting to its own
   constants. Production callers do not change.
2. `evalSettings({ model, efforts, baseline, repeats })` gives the run's settings. `efforts` is the eval's
   default sweep, lowest first; `null` for a call that takes no effort. `baseline` is the call site's effort
   constant (for example `baseline: SEARCH_EFFORT`); it is added to the sweep when missing.
3. `runSweep({ task, title, notes, settings, items, id, run, grade, score, afterSweep, columns, raw })`:
   - `run(item, context)` makes the model call only: the real call site with `context.config.model`,
     `context.config.effort` and `context.client` (or `context.fetch`), so usage, web searches and call times are
     counted. It is the only part that is timed. `context.client` is always on the standard tier. Send every
     OpenAI call of the run through these, so it is rate-limited. `context.responses()` gives the run's raw answers.
     Throwing is an error, not a crash.
   - `grade(item, output, context)` (optional) grades the output, after the run has freed its slot:
     `context.judge({ name, instructions, input, schema })` asks the judge model for strict JSON, with the rubric
     first and a cache key per rubric. A failed grade leaves the run ungraded. `context.shared(key, work)` does
     expensive work once for the whole sweep (reading a link, a verdict on it), whatever the config; its cost is
     the shared-work line.
   - `score(outcomes)` returns metrics, for all runs, for each repeat and for each item (the baseline
     comparison), so it must work on any subset of outcomes. Use `countHits(name, outcomes, test)`
     (an error is a miss), and `countGraded` or `gradedOutcomes` for the judge's grades. Helpers in
     `evals/lib/stats.ts`, `evals/lib/text.ts` and `evals/lib/concurrency.ts`; `evals/lib/testing.ts` builds outcomes for tests.
   - `afterSweep(configs, context)` (optional) sees every config's outcomes once all ran, for metrics that
     compare configs (the writer's pairwise judge). `context.judgeFor(config)` charges that config's judge cost.
   - `columns` (optional) picks the metric columns of the table.
   - `raw(outcome)` adds ids and numbers to the raw JSON. No third-party text.
4. `task` is the folder name. It names the results file.

## A model upgrade

Add the model's price to `evals/lib/usage.ts` and its limits to `RATE_LIMITS` in `evals/lib/rate-limit.ts`
(an unknown model gets a low limit), then run each eval with `EVAL_MODEL=<new model>` and the efforts you would
use. The baseline comparison is within the new model's rows; compare across models by eye. The new rows sit next to the current model's rows in each results file. Move a call
site only when its metrics hold and the cost and latency are acceptable.

Some evals drift by nature, so their old rows are not a fair baseline:

- Free links searches the live web and reads the pages it finds, which change from day to day.
- The writer's article text was read on the build day (`evals/data/writer/`, not committed), and the
  extraction text is rebuilt from public pages (`evals/data/extraction/`). A rebuild reads the pages as they are
  that day.

The scene evals, the lead pick and the repeat check run on committed test sets and do not drift. Still, the API
itself can change: for any upgrade, run today's model again in the same session, next to the new one, and
compare those rows.
