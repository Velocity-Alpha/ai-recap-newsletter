# Evals

Evals run the app's real model calls on fixed test sets and score the answers. Use them to pick the
reasoning effort of each call, and to check a new model before the app moves to it. They call OpenAI and cost
money, so `npm test` never runs them.

## Current choices

| Call | Effort | Why | Results |
|---|---|---|---|
| Story extraction (`src/pipeline/ingest/extract.ts`) | low | Its setting before the evals. Recall, precision and faithful stories are about level from none to medium; high misses fewer stories for about 2.5 times the cost. | [extraction.md](results/extraction.md) |
| Lead pick (`src/features/newsletter/openai-lead-pick.ts`) | low | Its setting before the evals. The AI lead matches the owner's on 15 or 16 of 30 boards at every effort, so effort buys nothing. | [lead-pick.md](results/lead-pick.md) |
| Repeat check (`src/pipeline/repeats/`, Decisions API) | n/a | The Decisions API takes no effort. | [repeats.md](results/repeats.md) |
| Issue writer (`src/pipeline/draft/writer.ts`) | high | Fewer claims the inputs do not support than low, and notes followed more often, for about 2 cents more per issue, well inside the 240 s timeout. | [writer.md](results/writer.md) |
| Scene prompt (`src/pipeline/draft/image/scene-prompt.ts`) | high | Keeps the prompt's hard rules most often; the call's p95 of about 33 s is well inside its 120 s timeout. | [scene-prompt.md](results/scene-prompt.md) |
| Scene ideas (`src/pipeline/draft/image/scene-ideas.ts`) | medium | High follows the composition rules a little better, but its call p95 reaches the 45 s timeout of the web request. | [scene-ideas.md](results/scene-ideas.md) |
| Free-link search (`src/pipeline/free-links/search.ts`) | none | Finds a usable link for the most stories (26 of 30 over 3 runs, against 22 of 30 at medium); it searches about twice as often, so it costs about twice as much and a request can reach the 120 s limit. | [free-links.md](results/free-links.md) |

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
npm run eval:build -- evals/writer/build-dataset.ts   # build a test set (scripts that are not evals)
npm run eval:rerender -- writer free-links            # rebuild results files from their stored rows, no API calls
```

| Variable | Meaning | Default |
|---|---|---|
| `EVAL_MODEL` | The model to run | the call site's model |
| `EVAL_EFFORTS` | Comma list of `none`, `low`, `medium`, `high`, `xhigh`, `max`, or `default` (send no effort) | each eval's sweep |
| `EVAL_REPEATS` | Runs of each item, to see the noise | each eval's |
| `EVAL_LIMIT` | Only the first N items | all |
| `EVAL_CONCURRENCY` | Items in flight at once | 4 (repeats: 8) |
| `EVAL_JUDGE_MODEL`, `EVAL_JUDGE_EFFORT` | The judge, for evals that grade text | `gpt-6-sol`, `high` |
| `EVAL_JUDGE_REPEATS` | Grade only the first N repeats of each item, to save judge cost | every repeat |

gpt-6-luna takes the efforts above and uses `medium` when none is sent
([model page](https://developers.openai.com/api/docs/models/gpt-6-luna)). The Decisions API (repeat check) takes
no effort and only `gpt-6-luna`, so its sweep is over `EVAL_MODEL` alone and `EVAL_EFFORTS` is refused.

## Results

A run writes `evals/results/<task>.md`: one row for each model and effort. It replaces the rows of the configs
it ran and keeps the others. Commit it. The rows are also stored as JSON at the end of the file, so
`npm run eval:rerender` can rebuild the table after a change to how results are shown. The raw run (each item's
ids, numbers, usage, call times and grade status) goes to `evals/out/<task>.json`, which git ignores.

The columns, after the eval's metrics:

- A count shows `hits/n (percent)`. With two or more repeats, each metric also shows the lowest and highest
  repeat in brackets, so the noise is visible: `21/30 (70%; 60–80%)`, or `7.4 (6.9–8.1)` for a number.
- `Errors`: runs whose call threw. An error is a miss in every count of the run.
- `Graded`: runs the judge graded, of the runs it tried. Judged counts are over the graded runs.
- `p50`, `p95`: the time of the model calls of one run. Grading is not timed.
- `Searches per call`: web search calls per run, for calls with the web search tool.
- `Cost per call`: tokens at the prices in `evals/lib/usage.ts`, plus $0.01 per web search call. A model with no
  price there shows `unknown`: add it first.
- `Judge cost per call`: the judge's cost spread over the runs.
- A line under the table gives the cost of shared work (see below), which is in neither cost column.

A column with no value in any row is left out. An eval can choose its metric columns (the writer does); every
metric stays in the stored rows. Rows from before 2026-11-11 timed the judge in p50 and p95; each eval's notes
say which of its old columns hold the call alone.

## Data, and the rule on third-party text

The repo is public. Results files hold metrics, story ids and our own headlines only, never article or
newsletter text. Test sets already in the repo (`src/**/__fixtures__/`) can be used as they are. A test set that
needs third-party text goes in `evals/data/` (git ignores it), made by a build script in the eval's folder from
the Neon `dev` branch (read-only, `evals/lib/dev-db.ts`) or public pages, run with `npm run eval:build`. Each
eval's notes say where its data came from.

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
2. `evalSettings({ model, efforts, repeats })` gives the run's settings. `efforts` is the eval's default sweep,
   lowest first; `null` for a call that takes no effort.
3. `runSweep({ task, title, notes, settings, items, id, run, grade, score, afterSweep, columns, raw })`:
   - `run(item, context)` makes the model call only: the real call site with `context.config.model`,
     `context.config.effort` and `context.client` (or `context.fetch`), so usage, web searches and call times are
     counted. It is the only part that is timed. `context.responses()` gives the run's raw answers. Throwing is
     an error, not a crash.
   - `grade(item, output, context)` (optional) grades the output: `context.judge({ name, instructions, input,
     schema })` asks the judge model for strict JSON, with the rubric first and a cache key per rubric. A failed
     grade leaves the run ungraded. `context.shared(key, work)` does expensive work once for the whole sweep
     (reading a link, a verdict on it), whatever the config; its cost is the shared-work line.
   - `score(outcomes)` returns metrics, for all runs and for each repeat. Use `countHits(name, outcomes, test)`
     (an error is a miss), and `countGraded` or `gradedOutcomes` for the judge's grades. Helpers in
     `evals/lib/stats.ts` and `evals/lib/text.ts`; `evals/lib/testing.ts` builds outcomes for tests.
   - `afterSweep(configs, context)` (optional) sees every config's outcomes once all ran, for metrics that
     compare configs (the writer's pairwise judge). `context.judgeFor(config)` charges that config's judge cost.
   - `columns` (optional) picks the metric columns of the table.
   - `raw(outcome)` adds ids and numbers to the raw JSON. No third-party text.
4. `task` is the folder name. It names the results file.

## A model upgrade

Add the model's price to `evals/lib/usage.ts`, then run each eval with `EVAL_MODEL=<new model>` and the
efforts you would use. The new rows sit next to the current model's rows in each results file. Move a call
site only when its metrics hold and the cost and latency are acceptable.
