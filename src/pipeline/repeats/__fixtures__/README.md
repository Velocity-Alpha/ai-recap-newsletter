# Repeat-story test set (#90)

Real stories and judged pairs, used to test the repeat check without calling any outside service.
Built on 2026-11-10 from the production `stories` table (read-only). News text only; no subscriber data.

## Files

| File | Rows | What one row is |
|---|---|---|
| `stories.jsonl` | 1,302 | A story with `day` from 2026-09-25 to 2026-11-10: `id`, `day`, `source`, `headline`, `summary`, `url`, `importance`, `published_on`, `queued_for`, `excluded`. |
| `judged-pairs.jsonl` | 2,136 | The recorded answers of the OpenAI Decisions API for one pair: `newer`, `older` (story ids), `similarity`, `rank`, `same`, `news`. |
| `labelled-pairs.jsonl` | 243 | A pair judged by a strong model: `a`, `b`, `label` (`same`, `follow_up`, `different`), `confidence`, `why`, plus the recorded `similarity`, `same`, `news`. |
| `blocks.jsonl` | 147 | A block of similar stories judged by Claude Haiku: `stories` (ids), `groups` (ids that are the same news), `follow_ups` (`[later, earlier]`), `unsure` (pairs left out of scoring). |

## How it was built

1. **Embeddings:** `text-embedding-3-small`, `dimensions: 512`, input `headline + "\n" + summary`.
2. **Pairs:** for each story, its 5 nearest stories by cosine similarity, among stories whose `day` is at most
   14 days away, with similarity 0.55 or more. `rank` is the best position (1 to 5) the pair had in either
   story's list. `newer` is the story with the later `day` (same day: the higher id).
3. **Recorded answers:** each pair went to `POST /v1/decisions` (`gpt-6-luna`) with two `predicate` questions.
   `same` and `news` are the returned probabilities. The request shape and the question texts are in issue #90
   and must stay equal to the ones in `src/pipeline/repeats/`. If a question text changes, record the answers
   again.
4. **Blocks:** stories linked by similarity 0.65 or more (blocks over 24 stories were split at a higher
   value). Haiku read each block and grouped the stories that are the same news.
5. **Labelled pairs:** a sample across all similarity levels (0.50 to 1.00), plus the repeats known from the
   archive analysis (`docs/n8n-backend/80-approval-and-source-analysis.md`).

## Labelling rules

- `same`: both report the same underlying development (event, announcement, release, filing, funding round,
  paper, ruling, product launch). A reader of one learns nothing important from the other. Source, wording,
  and level of detail do not matter. A one-line product listing and a news story about that launch are `same`.
- `follow_up`: same specific story line, and the later one reports something materially new (a next step, a
  result, a ruling, changed numbers, a response, a reversal).
- `different`: everything else, including two releases of one product, or two papers on one subject.

## Results on 2026-11-10

Rule: a pair is **sure** when `same >= 0.85` and `news <= 0.5`. A pair is **similar** when `same >= 0.5` and
it is not sure.

| Measure | Result |
|---|---|
| Labelled pairs: `same` pairs that are sure | 82 of 113 |
| Labelled pairs: `same` pairs that are sure or similar | 108 of 113 |
| Labelled pairs: `different` pairs that are sure | 0 of 118 |
| Labelled pairs: `follow_up` pairs that are sure | 2 of 12 (both labelled with low confidence) |
| Blocks: same-news pairs that are sure | 184 of 250 |
| Blocks: same-news pairs that are sure or similar | 244 of 250 |
| Blocks: sure pairs that Haiku called `different` | 9 of 208 sure pairs inside blocks |
| Cost of the 2,136 pairs | 1.27 million input tokens, about $0.13 |

To call the judge again on the labelled pairs (for a new model), run `npm run eval -- evals/repeats`.

Known weak spots: a "bundle" story that covers two events matches both, and a wrong summary from extraction
(story 10864) makes a true repeat look different.
