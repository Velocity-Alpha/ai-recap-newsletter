# Evals

Evals run the app's real model calls on fixed test sets and score the answers. Use them to pick the
reasoning effort of each call, and to check a new model before the app moves to it. They call OpenAI and cost
money, so `npm test` never runs them.

## Run

Every eval needs `OPENAI_API_KEY`. Never point `DATABASE_URL` at production: evals only read the Neon `dev`
branch, in read-only transactions.

```sh
npm run eval -- evals/lead-pick                       # one eval, with its default sweep
npm run eval                                          # every eval
EVAL_EFFORTS=low,high npm run eval -- evals/lead-pick # a sweep you choose
EVAL_LIMIT=2 EVAL_REPEATS=1 npm run eval -- evals/lead-pick # a quick run
```

| Variable | Meaning | Default |
|---|---|---|
| `EVAL_MODEL` | The model to run | the call site's model |
| `EVAL_EFFORTS` | Comma list of `none`, `low`, `medium`, `high`, `xhigh`, `max`, or `default` (send no effort) | each eval's sweep |
| `EVAL_REPEATS` | Runs of each item, to see the noise | each eval's |
| `EVAL_LIMIT` | Only the first N items | all |
| `EVAL_CONCURRENCY` | Items in flight at once | 4 (repeats: 8) |
| `EVAL_JUDGE_MODEL`, `EVAL_JUDGE_EFFORT` | The judge, for evals that grade text | `gpt-6-sol`, `high` |

gpt-6-luna takes the efforts above and uses `medium` when none is sent
([model page](https://developers.openai.com/api/docs/models/gpt-6-luna)). The Decisions API (repeat check) takes
no effort and only `gpt-6-luna`, so its sweep is over `EVAL_MODEL` alone and `EVAL_EFFORTS` is refused.

## Results

A run writes `evals/results/<task>.md`: one row for each model and effort, with each metric, errors, latency
p50 and p95, cost per item run, n, date and git sha. It replaces the rows of the configs it ran and keeps the
others. Commit it. The raw run (each item's answer ids and latency) goes to `evals/out/<task>.json`, which git
ignores.

Cost comes from the API's `usage` (input, cached, output and reasoning tokens) and the prices in
`evals/lib/usage.ts`. A model with no price there shows `unknown`: add it first. On 2026-11-10 the default lead-pick sweep
(4 efforts, 3 repeats) cost about 1.5 cents, and a repeats run about 1.6 cents.

## Data, and the rule on third-party text

The repo is public. Results files hold metrics, story ids and our own headlines only, never article or
newsletter text. Test sets already in the repo (`src/**/__fixtures__/`) can be used as they are. A test set that
needs third-party text goes in `evals/data/` (git ignores it), made by a build script in the eval's folder from
the Neon `dev` branch (read-only, `evals/lib/dev-db.ts`). Say in the eval's notes where its data came from.

- `lead-pick`: the 10 archived boards and the owner's leads
  (`src/features/newsletter/__fixtures__/archived-boards.json`), with summaries from the Neon `dev` branch when
  `DATABASE_URL` is set, else headlines only. The results file says which.
- `repeats`: the 243 labelled pairs and their stories (`src/pipeline/repeats/__fixtures__/`).

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
3. `runSweep({ task, title, notes, settings, items, id, run, score, raw })`:
   - `run(item, context)` calls the real call site with `context.config.model`, `context.config.effort` and
     `context.client` (or `context.fetch`), so usage and cost are counted. Throwing is an error, not a crash.
   - `score(outcomes)` returns metrics: use `countHits(name, outcomes, test)`; an error counts as a miss.
   - `raw(outcome)` adds ids and numbers to the raw JSON. No third-party text.
   - `context.judge({ name, instructions, input, schema })` asks the judge model for strict JSON, for evals
     that grade text. Its cost has its own column.
4. `task` is the folder name. It names the results file.

## A model upgrade

Add the model's price to `evals/lib/usage.ts`, then run each eval with `EVAL_MODEL=<new model>` and the
efforts you would use. The new rows sit next to the current model's rows in each results file. Move a call
site only when its metrics hold and the cost and latency are acceptable.
