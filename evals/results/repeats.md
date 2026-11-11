# Repeat check eval

Written by `npm run eval -- evals/repeats`; `npm run eval:rerender -- repeats` rebuilds it from the
rows stored below. Do not edit by hand. A run replaces the rows of the model and effort it ran; other rows stay.
Latency and cost are for one item run; a range in brackets is the lowest and highest repeat; pts are the
difference against the baseline row of the same run, with its 95% interval. See evals/README.md.

The Decisions API judge of the repeat check on 303 labelled pairs: the 243 of `src/pipeline/repeats/__fixtures__/labelled-pairs.jsonl` (labels by a strong model; see its README.md), and 60 of `evals/repeats/new-pairs.json` with golden labels by Claude Opus by the same rules (`evals/repeats/golden.json`; 0 new pairs have none yet and are left out). One request for each pair. Levels use the thresholds in `repeat-rules.ts`: sure, similar, or none.

The Decisions API takes no reasoning effort and accepts only gpt-6-luna today, so the sweep is over the model alone. It does not charge output tokens.

| Model | Effort | same -> sure | same -> sure or similar | different -> sure | follow_up -> sure | refused | Errors | p50 | p95 | Cost per call | n | Date | Git sha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6-luna | n/a | 100/145 (69%) | 140/145 (97%) | 0/129 (0%) | 3/29 (10%) | 0/303 (0%) | 0 | 0.2 s | 1.1 s | $0.000066 | 303 | 2026-11-11 | f2f38e6+changes |

<!-- eval-results
{"title":"Repeat check eval","notes":["The Decisions API judge of the repeat check on 303 labelled pairs: the 243 of `src/pipeline/repeats/__fixtures__/labelled-pairs.jsonl` (labels by a strong model; see its README.md), and 60 of `evals/repeats/new-pairs.json` with golden labels by Claude Opus by the same rules (`evals/repeats/golden.json`; 0 new pairs have none yet and are left out). One request for each pair. Levels use the thresholds in `repeat-rules.ts`: sure, similar, or none.","The Decisions API takes no reasoning effort and accepts only gpt-6-luna today, so the sweep is over the model alone. It does not charge output tokens."],"rows":[{"model":"gpt-6-luna","effort":"n/a","n":303,"errors":0,"metrics":[{"name":"same -> sure","hits":100,"n":145},{"name":"same -> sure or similar","hits":140,"n":145},{"name":"different -> sure","hits":0,"n":129},{"name":"follow_up -> sure","hits":3,"n":29},{"name":"refused","hits":0,"n":303}],"latencyMs":{"p50":168,"p95":1056},"costPerCallUsd":0.00006618547854785479,"judgeCostPerCallUsd":null,"date":"2026-11-11","gitSha":"f2f38e6+changes"}]}
-->
