# Lead pick eval

Written by `npm run eval -- evals/lead-pick`; `npm run eval:rerender -- lead-pick` rebuilds it from the
rows stored below. Do not edit by hand. A run replaces the rows of the model and effort it ran; other rows stay.
Latency and cost are for one item run; a range in brackets is the lowest and highest repeat. See evals/README.md.

The AI lead pick on the 10 archived boards of 2026-10-22 to 2026-11-04 (`src/features/newsletter/__fixtures__/archived-boards.json`). Ground truth: the lead the owner committed.

AI lead = owner lead: the board's lead after the AI pick (a failed pick leaves the scored lead). The shortlist and score-only rows do not depend on the model.

Story text: headlines, and summaries for 428 of the 428 board stories (`evals/lead-pick/summaries.json`, built from the Neon dev branch).

Latency includes background-mode polling once a second.

| Model | Effort | AI lead = owner lead | AI pick usable | Owner lead on shortlist | Score-only lead = owner lead | Errors | p50 | p95 | Cost per call | n | Date | Git sha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6-luna | none | 15/30 (50%) | 30/30 (100%) | 24/30 (80%) | 9/30 (30%) | 0 | 3.0 s | 13.1 s | $0.000073 | 30 | 2026-11-11 | 1e73840+changes |
| gpt-6-luna | low | 16/30 (53%) | 30/30 (100%) | 24/30 (80%) | 9/30 (30%) | 0 | 4.1 s | 15.6 s | $0.000116 | 30 | 2026-11-11 | 1e73840+changes |
| gpt-6-luna | medium | 16/30 (53%) | 30/30 (100%) | 24/30 (80%) | 9/30 (30%) | 0 | 5.2 s | 16.6 s | $0.000147 | 30 | 2026-11-11 | 1e73840+changes |
| gpt-6-luna | high | 15/30 (50%) | 30/30 (100%) | 24/30 (80%) | 9/30 (30%) | 0 | 6.2 s | 23.7 s | $0.000172 | 30 | 2026-11-11 | 1e73840+changes |

<!-- eval-results
{"title":"Lead pick eval","notes":["The AI lead pick on the 10 archived boards of 2026-10-22 to 2026-11-04 (`src/features/newsletter/__fixtures__/archived-boards.json`). Ground truth: the lead the owner committed.","AI lead = owner lead: the board's lead after the AI pick (a failed pick leaves the scored lead). The shortlist and score-only rows do not depend on the model.","Story text: headlines, and summaries for 428 of the 428 board stories (`evals/lead-pick/summaries.json`, built from the Neon dev branch).","Latency includes background-mode polling once a second."],"rows":[{"model":"gpt-6-luna","effort":"none","n":30,"errors":0,"metrics":[{"name":"AI lead = owner lead","hits":15,"n":30},{"name":"AI pick usable","hits":30,"n":30},{"name":"Owner lead on shortlist","hits":24,"n":30},{"name":"Score-only lead = owner lead","hits":9,"n":30}],"latencyMs":{"p50":3023,"p95":13059},"costPerCallUsd":0.00007321933333333334,"judgeCostPerCallUsd":null,"date":"2026-11-11","gitSha":"1e73840+changes"},{"model":"gpt-6-luna","effort":"low","n":30,"errors":0,"metrics":[{"name":"AI lead = owner lead","hits":16,"n":30},{"name":"AI pick usable","hits":30,"n":30},{"name":"Owner lead on shortlist","hits":24,"n":30},{"name":"Score-only lead = owner lead","hits":9,"n":30}],"latencyMs":{"p50":4148,"p95":15602},"costPerCallUsd":0.00011554033333333333,"judgeCostPerCallUsd":null,"date":"2026-11-11","gitSha":"1e73840+changes"},{"model":"gpt-6-luna","effort":"medium","n":30,"errors":0,"metrics":[{"name":"AI lead = owner lead","hits":16,"n":30},{"name":"AI pick usable","hits":30,"n":30},{"name":"Owner lead on shortlist","hits":24,"n":30},{"name":"Score-only lead = owner lead","hits":9,"n":30}],"latencyMs":{"p50":5217,"p95":16635},"costPerCallUsd":0.000146586,"judgeCostPerCallUsd":null,"date":"2026-11-11","gitSha":"1e73840+changes"},{"model":"gpt-6-luna","effort":"high","n":30,"errors":0,"metrics":[{"name":"AI lead = owner lead","hits":15,"n":30},{"name":"AI pick usable","hits":30,"n":30},{"name":"Owner lead on shortlist","hits":24,"n":30},{"name":"Score-only lead = owner lead","hits":9,"n":30}],"latencyMs":{"p50":6217,"p95":23689},"costPerCallUsd":0.00017231933333333334,"judgeCostPerCallUsd":null,"date":"2026-11-11","gitSha":"1e73840+changes"}]}
-->
