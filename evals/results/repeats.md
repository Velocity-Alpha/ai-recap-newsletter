# Repeat check eval

Written by `npm run eval -- evals/repeats`. Do not edit by hand. A run replaces the rows of the model and
effort it ran; other rows stay. Latency and cost are for one item run. See evals/README.md.

The Decisions API judge of the repeat check on the 243 labelled pairs of `src/pipeline/repeats/__fixtures__/` (labels by a strong model; see its README.md). One request for each pair. Levels use the thresholds in `repeat-rules.ts`: sure, similar, or none.

The Decisions API takes no reasoning effort and accepts only gpt-6-luna today, so the sweep is over the model alone. It does not charge output tokens.

| Model | Effort | same -> sure | same -> sure or similar | different -> sure | follow_up -> sure | refused | Errors | p50 | p95 | Cost per call | n | Date | Git sha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6-luna | n/a | 80/113 (71%) | 108/113 (96%) | 0/118 (0%) | 2/12 (17%) | 0/243 (0%) | 0 | 0.2 s | 0.4 s | $0.000066 | 243 | 2026-11-11 | 1e73840+changes |

<!-- eval-rows
[{"model":"gpt-6-luna","effort":"n/a","n":243,"errors":0,"metrics":[{"name":"same -> sure","hits":80,"n":113},{"name":"same -> sure or similar","hits":108,"n":113},{"name":"different -> sure","hits":0,"n":118},{"name":"follow_up -> sure","hits":2,"n":12},{"name":"refused","hits":0,"n":243}],"latencyMs":{"p50":167,"p95":441},"costPerCallUsd":0.00006622057613168725,"judgeCostPerCallUsd":null,"date":"2026-11-11","gitSha":"1e73840+changes"}]
-->
