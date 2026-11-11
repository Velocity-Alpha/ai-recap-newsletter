# Evals

Evals run the app's real model calls on fixed test sets and score the answers. Use them to pick the
reasoning effort of each call, and to check a new model before the app moves to it. They call OpenAI and cost
money, so `npm test` never runs them.

## Current choices

| Call | Effort | Why | Results |
|---|---|---|---|
| Story extraction (`src/pipeline/ingest/extract.ts`) | medium | Medium covers more of the stories in the text (recall 339 of 358 against 329 of 364; the repeat ranges do not overlap), misses fewer per issue (0.79 against 1.46), puts more stories in the right category (287 of 319 against 248 of 315) and rates importance closer (309 of 319 within 1, against 290 of 315). Against it: URL right is 322 of 329 against 321 of 323, mostly links that drop a query string or a trailing slash and still open the page. Faithful stories are within noise. $0.0025 a call against $0.0016; p95 63.4 s of the 120 s timeout. | [extraction.md](results/extraction.md) |
| Lead pick (`src/features/newsletter/openai-lead-pick.ts`) | low | Effort does not change the pick: the AI lead is the owner's lead in 15 or 16 of 30 runs over 10 boards at every effort from none to high (9 of 30 for the scored lead alone). Low was its setting before the evals. | [lead-pick.md](results/lead-pick.md) |
| Repeat check (`src/pipeline/repeats/`, Decisions API) | n/a | The Decisions API takes no effort. | [repeats.md](results/repeats.md) |
| Issue writer (`src/pipeline/draft/writer.ts`) | high | Two judge counts over 12 runs of 6 issues: 0.33 unsupported claims per issue against 1.08 at low, and notes followed in 35 of 36 against 28 of 36. Not the pairwise judge, where high against low is a tie (0.5). $0.0043 a call against $0.0021, about 0.2 cents more per issue; the slowest call took 59.8 s of the 240 s timeout. | [writer.md](results/writer.md) |
| Scene prompt (`src/pipeline/draft/image/scene-prompt.ts`) | medium | All hard rules in 17 of 20 runs, against 19 of 20 at high and 18 of 20 at the API default, which is medium too: a gap of this size is noise. High costs about twice as much ($0.0014 a call against $0.000737). | [scene-prompt.md](results/scene-prompt.md) |
| Scene ideas (`src/pipeline/draft/image/scene-ideas.ts`) | medium | High keeps more ideas to one supporting element (50 of 60 against 43 of 60), but its call p95 is 44.5 s against the 45 s timeout of the web request, and 1 of its 20 calls failed. | [scene-ideas.md](results/scene-ideas.md) |
| Free-link search (`src/pipeline/free-links/search.ts`) | medium | A usable link for 22 of 30 stories over 3 runs (70–80% per run), against 24 of 30 (70–90%) at none: the ranges overlap. None costs 2.3 times as much ($0.0832 a request against $0.0368), its p95 is 101.1 s against the 120 s limit, and 1 of its 30 requests failed. | [free-links.md](results/free-links.md) |

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
  The difference is stored in the row's JSON; older rows have none and show none.
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
metric stays in the stored rows. Rows with a git sha from before d1da5b8 timed the judge in p50 and p95; each
eval's notes name those rows and say which of their columns hold the call alone.

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
from Claude Code. The judge compares each output to it. A golden file is JSON:
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
