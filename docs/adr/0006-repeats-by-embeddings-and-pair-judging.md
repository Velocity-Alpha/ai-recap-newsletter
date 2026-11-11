# 0006 — Repeats are found with embeddings and pair judging at ingestion

- **Status:** Accepted, 2026-11-10.
- **Background:** issues #90 and #56, the test set in `src/pipeline/repeats/__fixtures__/` (read its `README.md`).

## Context

The board must not propose news that the newsletter already ran. 8 of 11 exclusions in the archive were stories
published 2 to 6 days earlier. The old check looked back 2 days (3 on a Monday), with one large AI call when the
board loads.

## Decision

Find repeats at ingestion, one pair of stories at a time, and store the result:

1. Each story gets one embedding (`text-embedding-3-small`, 512 numbers), made once.
2. For each new story, find its 5 nearest stories within the window (`repeats.window_days`, default 14), with a
   cosine similarity of 0.55 or more. This is arithmetic in the app.
3. Each pair goes to the OpenAI Decisions API (`gpt-6-luna`) with two yes/no questions: is it the same news
   (`same`), and does the newer story report something new (`news`).
4. Each pair is one row in `story_matches`.

A pair is **sure** when `same >= 0.85` and `news <= 0.5`, and **similar** when `same >= 0.5` and it is not sure.
The board turns the stored pairs into repeats removed, duplicates grouped, and labels, with pure functions
(`src/pipeline/repeats/repeat-rules.ts`). Only a direct sure pair removes a story: a chain of pairs only labels it,
because a story that covers two events would link two different news items.

The thresholds come from the measured test set. Do not change them without running the fixture tests.

## Rejected options

- **One large AI call when the board loads.** It does not scale past a few days: 14 days are about 600 stories,
  too many for one prompt and for the board's wait. It also gives no stored result to reuse or inspect.
- **The `pgvector` extension.** Not needed at about 600 stories in a window: the nearest-story search takes
  milliseconds in the app. It would add an extension to manage on each Neon branch.

## Consequences

- About 40 new stories a day: one embedding request and about 40 Decisions requests, under one cent a day.
- A failure of the check never fails ingestion. A story with `matched_at` null is tried again.
- The board runs the same check, before it reads the matches, for each candidate with `matched_at` null (a story
  that a failed run left, or one that arrived after the last run). That is a few pairs, not one large call. If it
  fails, the board still loads with the stored matches and says that the check did not finish.
- Whether two story rows report the same news is answered by `story_matches`, not by a key. The stable key of a
  story is its id ([ADR 0007](./0007-story-id-is-the-stable-key.md)).
- The installed `openai` package (6.x) has no Decisions method, so the endpoint is called with `fetch`.
