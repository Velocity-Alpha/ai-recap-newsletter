# Research: section scoring with the Decisions API (#176)

Run on **2026-11-12**. This is the first step of #176: score past stories with the OpenAI Decisions API over
first-draft section definitions, and compare the result with what the owner published.

## Summary

- **The first draft does not beat today's ranking.** Automatic fill with Decisions API scores pre-selected 43% of the
  owner's stories. Today's ranking (category from extraction, extraction importance plus keywords) pre-selected 63%.
- **Past issues cannot judge a new ranking fairly.** The board showed the owner about 28 stories a day, chosen by
  today's ranking. 83% of published stories come from that set. A new ranking loses every time it prefers a story
  the owner never saw.
- **Inside the shown set, nothing predicts the owner's picks well.** Today's rank value is a little better than
  chance. Decisions importance is at chance. A simple model trained on past picks is no better.
- **The API itself works as #176 needs.** One request per story returns the full distributions (`choice` over
  sections, `score` for importance, one `predicate` per section). 2,735 stories cost $0.51 and had no failed calls.
- **`predicate` per section fits the fill-order idea better than one `choice`.** With `choice`, Top Stories takes the
  probability away from Quick Hits and Tools.
- **Decision for #176:** the section model (sections as data, fill order, stored distributions) can go ahead. The
  claim "Decisions API scoring is better than extraction scoring" is not shown. Keep extraction importance until a
  fair test says otherwise.

## Method

The harness is [`evals/section-scoring/run.ts`](../../evals/section-scoring/run.ts). The section definitions and
importance levels are in [`evals/section-scoring/sections.ts`](../../evals/section-scoring/sections.ts), written
from today's extraction rules. They are a first draft, not tuned.

- **Data** (Neon `dev`, read-only): 57 published issues from 2026-08-01, 721 published stories with the owner's
  section (`issue_stories`), and 2,735 stories in the candidate windows of those days (median 93 a day).
- **One request per story** (headline, summary, story detail) with 6 questions: a `choice` over the 4 sections and
  `none`; a `score` with the 5 levels of the importance rubric; a `predicate` for each section.
- **Automatic fill:** go through the sections in fill order (Top Stories, Research & Analysis, Tools, Quick Hits)
  with fill counts 3, 4, 3, 6. A section takes its best stories that no earlier section took. A story's value for a
  section is fit × importance.
- **By event:** stories with embedding similarity 0.7 or more count as one event, so a method is not punished for
  picking another newsletter's copy of the same news. (Of the repeat check's judged pairs at 0.7 or more, the judge
  called 30 of 37 the same development.)
- **Stream rank:** the place of each published story in its section's stream, after the owner's stories of other
  sections are removed.

## Results

### Section

Published stories, 716 with scores:

| Measure | Result |
|---|---|
| `choice` top option is the owner's section (4 sections) | 57% |
| Owner's section is in the top two options | 86% |
| Same group, with Top Stories and Quick Hits as one group: `choice` | 78% |
| Same group: `predicate` | 80% |
| Same group: today's category | 93% |
| `predicate` for the owner's section is 0.5 or more | 85% |

Owner's section (rows) against the `choice` top option (columns):

| | Top Stories | Research | Tools | Quick Hits |
|---|---|---|---|---|
| Top Stories (163) | 122 | 4 | 25 | 12 |
| Research & Analysis (203) | 13 | 172 | 5 | 13 |
| Tools (142) | 58 | 2 | 80 | 2 |
| Quick Hits (208) | 138 | 7 | 30 | 33 |

- Quick Hits stories read as Top Stories. That is correct under the fill-order idea: the difference between the two
  is rank, not topic. But `choice` then leaves Quick Hits with a low probability.
- 58 of 142 Tools stories read as Top Stories. The Top Stories definition ("a leading AI company ships a new
  product") is too wide.
- Today's category scores 93%, but the board placed stories by category and the owner seldom moved them. That
  number is partly the board agreeing with itself.

### Importance

AUC is the chance that a published story scores above an unpublished one (0.5 is chance, 1 is perfect).

| Measure | Published vs not published | Top Stories vs Quick Hits |
|---|---|---|
| Decisions importance | 0.714 | 0.616 |
| Extraction importance | 0.781 | 0.698 |

Mean importance of Top Stories: Decisions 3.29, extraction 4.31. The Decisions score is an average over levels, so
it stays near the middle.

### Automatic fill and stream rank, by event

| Method | Pre-selected in the right section | Pre-selected in any section | Top Stories in top 10 of the stream | Quick Hits in top 10 |
|---|---|---|---|---|
| Today (category, extraction importance + keywords) | 48% | 63% | 88% | 70% |
| `choice` × Decisions importance | 21% | 32% | 65% | 35% |
| `predicate` × Decisions importance | 26% | 43% | 64% | 51% |
| `predicate` × extraction importance | 31% | 51% | 74% | 61% |
| Today's category × Decisions importance | 29% | 43% | 74% | 60% |

With `predicate`, every published story is in its section's stream, and 72% to 89% are in the top 20.

### Only the stories the board showed

The board shows, by today's rank, 15 general stories, 7 research stories and 6 tools stories. AUC inside one day
and one group, published against shown but not published:

| Measure | General | Research | Tools |
|---|---|---|---|
| Today's rank value | 0.604 | 0.499 | 0.735 |
| Extraction importance | 0.526 | 0.535 | 0.692 |
| Decisions importance | 0.471 | 0.522 | 0.615 |
| `predicate` × Decisions importance | 0.465 | 0.490 | 0.627 |
| `predicate` only | 0.444 | 0.380 | 0.582 |

Today's rank value keeps an advantage here too: its top stories were pre-selected, and the owner had to act to
remove them.

A logistic regression trained on earlier picks and tested on later days (4 steps forward in time) gave: from
embeddings 0.52, 0.57, 0.47; from the Decisions answers 0.46, 0.62, 0.47; from today's values 0.59, 0.50, 0.78.
So about 590 picks do not hold a pattern that a simple model can learn. This check was run outside the repo.

## Limits

- The owner's picks depend on what the board showed and pre-selected. This is the main limit.
- The definitions are a first draft with no tuning. One run.
- The candidate windows are rebuilt from today's data. Stories excluded before 2026-11-11 carry no date, so some
  windows hold stories the owner had already excluded.
- The event grouping is approximate (about 80% precise).

## What this means for #176

1. **Build the section model with the scoring behind one interface.** Sections as data, fill order, fill counts and
   stored distributions do not depend on which scorer is best.
2. **Use `predicate` per section, not one `choice`.** It lets a story fit Top Stories and Quick Hits at once, which
   the fill order needs.
3. **Keep extraction importance for now.** It is at least as good as Decisions importance on this data. This also
   removes the planned saving in the extraction prompt until a later test.
4. **Collect fair labels.** The endless stream shows the owner far more than 28 stories, and every pick, skip and
   move is a label that does not depend on one ranking. That data, not past issues, should tune definitions and
   compare scorers.
5. **Tune the definitions with the owner** before another scoring run: narrow Top Stories, and say what makes a
   research story worth a place (the owner picks practical results more than plain papers).

## Run it again

```sh
DATABASE_URL="$(neon connection-string dev --project-id damp-boat-84187674 --role-name neondb_owner --database-name neondb)" \
OPENAI_API_KEY=... \
npx vite-node --config evals/vitest.eval.config.ts evals/section-scoring/run.ts
```

Scores are cached in `evals/data/section-scoring/` (local only) by story and by a hash of the questions. A change to
a definition makes a new version and new calls (about $0.50 for all stories). `SECTION_SCORING_LIMIT=20` runs a
smoke test.
