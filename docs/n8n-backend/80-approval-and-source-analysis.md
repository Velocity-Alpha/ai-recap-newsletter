# Approval edits, newsletter arrival, and source yield

Status: analysis, 2026-11-04. Read-only: no n8n changes, no webhook calls, no database writes. Read
[README.md](./README.md), [10-ingestion.md](./10-ingestion.md) and
[30-approval-and-telegram.md](./30-approval-and-telegram.md) first for how the pipeline works.

This document collects facts for one design decision: what a rebuilt pipeline must propose so that the daily
approval is usually "accept as is". It answers three questions:

1. What does the reviewer edit on the approval board, and why is approval slow?
2. When do the source newsletters arrive?
3. Which sources end up in published issues, and how often does the same story come from several sources?

All times are US Eastern (ET) unless marked UTC.

## At a glance

### Approval (Q1)

- **No commit was "accept as is."** None of the 10 reviewer commits in the archive (2026-10-22 to 11-04)
  matched the board's default pre-selection. The median commit touched 5.5 stories.
- **Most of the default survives.** 94 of 122 approved stories (77%) were in the default selection, and 77
  (63%) stayed in the same section. The longer DB history agrees: across 64 issues and 839 published stories
  from July to November, 80% were default-selected and 76% stayed in the same section.
- **What the reviewer changes, per commit on average:**
  - 3.1 section moves;
  - 2.7 fill-in stories promoted;
  - 1.1 exclusions;
  - 0.3 demotions;
  - 0.4 URL edits.
- **What the reviewer never changes:** notes (0) and headline text (0; the board cannot edit headlines).
- **The default board is about a third empty.** The AI dedup step removes a median 10 of the 28 slot stories
  and nothing backfills them. As a result the default selects a median 10 stories, against 12.5 approved.
  Quick Hits is the thinnest section: 1.5 stories by default against 3.2 approved.
- **No lead is proposed.** The reviewer picked the default #1 Top Story as the lead in only 2 of 10 commits.
- **Exclusions are mostly repeats.** 8 of 11 excluded stories had already been published 2 to 6 days
  earlier. The dedup step only looks back 2 days (3 on Mondays). No exclusion reason is ever saved.
- **URL edits fix paywalls.** All 4 URL edits replaced a paywalled link (WSJ, NYT, Axios) with a free copy.
- **The wait is reviewer availability, not editing.** The Telegram "ready" ping fires at about 09:56. The
  commit came a median 110 min later (range 3 to 227). Since May 2026 (102 dates) the median is 88 min, with
  p75 at 166 min. The two fastest commits (3 and 9 min) had some of the most edits (7 and 14 stories
  touched).
- **Re-commits are rare.** There were none in the archive. Since May, 8 of 110 dates had 2 or 3 issue rows.

### Arrival (Q2)

**Arrival time by source:**

| Source | Days | Typical time | Range |
|---|---|---|---|
| Rundown | daily | 06:08 | 06:04 to 06:11 |
| AlphaSignal | weekdays | 09:12 | 09:04 to 09:14 |
| TLDR | Tue to Fri | 09:53 | 09:52 to 09:54 (Tue 09:36) |
| AI Breakfast | Mon, Wed, Fri only | 11:39 | 09:41 to 12:22 |
| The Signal | 2 to 3 times a week, Sundays included | n/a | 09:16 to 11:22 |
| Aloa | none since 2026-04-27 | n/a | n/a |

- **TLDR is never seen on Mondays,** and on Wed to Fri it lands only 1 to 3 min before the 09:55 cron.
- **Gmail sources in the inbox by each cutoff, typical weekday:**

  | Cutoff | 06:00 | 07:00 | 08:00 | 09:00 | 09:30 | 09:55 | 13:00 |
  |---|---|---|---|---|---|---|---|
  | Sources in | 0 | 1 | 1 | 1 | 2 | 3 (range 2 to 5) | 3 (max 5) |

- **The 09:55 run misses AI Breakfast** on most of its days: 1 of 5 in the archive arrived before the run, and
  25 of 49 since July were ingested on the same day.
- **Product Hunt and Hugging Face are ready long before 09:55.** The Product Hunt feed is complete by about
  03:00. The Hugging Face daily-papers list for the day exists from 19:00 or 20:00 the previous evening, but
  its upvotes are still accumulating at 09:55.

### Sources in published issues (Q3)

- **Scope:** 153 published issues with story ids (2026-03-03 to 11-04), 2,022 story slots.
- **All-time share of published stories:**

  | Source | Share |
  |---|---|
  | TLDR | 29.6% |
  | Rundown | 21.6% |
  | AI Breakfast | 17.6% |
  | AlphaSignal | 10.6% |
  | Hugging Face | 7.3% |
  | Product Hunt | 4.9% |
  | Aloa | 4.3% |
  | The Signal | 4.1% |

- **Last 8 weeks** (from 09-07; 38 issues, 458 slots):

  | Source | Share of published |
  |---|---|
  | AlphaSignal | 21.0% |
  | TLDR | 20.1% |
  | AI Breakfast | 17.2% |
  | Hugging Face | 16.6% |
  | Rundown | 14.8% |
  | The Signal | 7.4% |
  | Product Hunt | 2.8% |

  - Hugging Face fills 57% of Research and AlphaSignal fills 44% of Tools.
  - Product Hunt has the lowest yield: 4.5% of ingested stories get published, against 25% to 37% for every
    other source.
- **Same story from 2+ sources on the same day:** this happened for 23 of 381 story clusters (6%). That is
  2.3 per day, on 9 of 10 archive days.
  - In 19 of the 23, the sources shared the exact URL, so the upsert merged them into one DB row that carries
    only the last source's label. Counts from the DB alone therefore show only 0.6 per day.
  - Multi-source stories were published more often (43% vs 29%). When published, they went to Top Stories 8
    of 10 times.

### What a system must propose so approval is usually "accept as is"

1. **A complete issue,** about 3 Top Stories, 3 to 4 Research, 3 Tools and 3 to 6 Quick Hits, with backfill
   after dedup. The board should not show empty slots.
2. **A proposed lead story.**
3. **Dedup against at least 7 to 10 days** of published and approved stories, by URL and by meaning. Stale
   repeats from The Signal and AI Breakfast are the main exclusion cause.
4. **Sections assigned by editorial role,** not by keyword. Many stories move from Top Stories to Quick Hits,
   and from Tools to Quick Hits.
5. **Coverage by several sources as a ranking signal** for Top Stories.
6. **Free URLs when a paywalled one is found,** using the other sources' links for the same story.
7. **One-tap accept, with reason codes on excludes and moves,** so the system can measure and learn.

Ingestion should follow arrivals: an early run (Rundown by 06:15) and a late run or an on-arrival trigger
(AI Breakfast by 12:30). Approval speed itself depends on when the reviewer gets to it.

## 1. Data used

| Source | What it gives | Coverage |
|---|---|---|
| n8n archive `ai-recap-n8n-archive/2026-11-04/executions/2-public-approval-page` | Approval webhook bodies (approved ids per section, excluded ids, notes, URL edits, lead) | 11 executions, 2026-10-22 to 11-04. The 10-30 commit errored (21269) and was replayed by hand (21275, same JWT `iat`), so there are 10 reviewer commits. |
| `.../1-fetch-stories` | Gmail items with `x-received` headers, Product Hunt and Hugging Face items, Telegram ping `result.date` | 11 executions: 10 daily runs from 10-22 to 11-04, plus 1 older execution stuck in waiting (skipped) |
| `.../extract-and-store-v2` | Per-email extraction output before the guid upsert merges rows | 63 runs, 413 extracted rows |
| Neon prod `newsletter.stories`, `newsletter.issues` (read-only) | Full history: `exclude_from_candidates`, `note`, `queued_for_publication_date`, `used_in_publication_date`, guid vs url, `createdAt`, `content_json` | 2026-03 to 2026-11-04 |
| `src/features/newsletter/curation.service.ts` | How the approval board builds its default pre-selection | Current code |

**Definitions:**

- **Pool:** the candidate stories the board query returns for the date. The rules are:
  - `importance_score >= 2`;
  - `day` in [D-3, D];
  - not used, not excluded;
  - URL not a tldr, rundown or beehiiv link;
  - guid-deduped.
- **Slots:** the 28 positions the blueprint fills before AI dedup, made of selected and fill-in positions per
  section:

  | Section | Selected | Fill-in |
  |---|---|---|
  | Top Stories (headlines) | general[0:3] | general[3:6] |
  | Research | research[0:4] | research[4:7] |
  | Tools | tools[0:3] | tools[3:6] |
  | Quick Hits | general[6:12] | general[12:15] |

- **Default selected:** the stories in selected positions that survive AI dedup. The board pre-checks them.
- **Shown:** every story visible on the board (selected plus fill-in, after dedup).
- **Promoted:** approved, but it was a fill-in in the default. **Demoted:** default-selected, but the reviewer
  left it as a fill-in. **Excluded:** in the commit's `excluded_ids`. **Moved:** approved in a different
  section than its default section.
- **Ping:** the Telegram "ready" message at the end of Fetch Stories. **Commit:** the approval webhook.
- **Source names** are normalized as follows:

  | Raw `stories.source` values | Normalized |
  |---|---|
  | `rundown_ai`, `rundown`, `Rundown` | Rundown |
  | `aloa`, `aloa_ai`, `bytesizedata` | Aloa |
  | `ai_breakfast`, `beehiiv`, `beehiiv_ai_breakfast` | AI Breakfast |
  | `the_signal` | The Signal |
  | `tldr` | TLDR |
  | `tldr_ai` before 2026-07-01 04:00 UTC | TLDR |
  | `tldr_ai` from 2026-07-01 04:00 UTC (the label flip described in doc 10) | The Signal |
  | `alphasignal`, `product_hunt_ai`, `huggingface` | AlphaSignal, Product Hunt, Hugging Face |

## 2. Q1: What the reviewer edits

### 2.1 Per commit (archive)

I rebuilt the default board for each commit as it stood at commit time, using a Python port of
`curation.service.ts`, then compared it with the commit body. The rebuild explains 162 of the 163 visible
stories. The one it cannot place is story 10832 on 10-28, which was approved but is not counted as either
default or promoted.

| Date | Commit (ET) | Pool | Removed by dedup (of 28 slots) | Shown | Default selected | Approved | Approved that were default | Promoted | Demoted | Excluded | Moved | URL edits | Notes | Lead = default #1? | Stories touched |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10-22 | Thu 12:11 | 136 | 15 | 13 | 10 | 12 | 9 | 3 | 1 | 0 | 1 | 0 | 0 | yes | 4 |
| 10-23 | Fri 09:58 | 137 | 16 | 12 | 8 | 11 | 7 | 4 | 0 | 1 | 4 | 0 | 0 | yes | 7 |
| 10-26 | Mon 11:51 | 42 | 1 | 17 | 10 | 10 | 8 | 2 | 1 | 1 | 5 | 0 | 0 | no (from Tools) | 9 |
| 10-27 | Tue 11:41 | 52 | 14 | 13 | 11 | 11 | 10 | 1 | 0 | 1 | 3 | 0 | 0 | no (#2) | 5 |
| 10-28 | Wed 13:03 | 71 | 15 | 14 | 9 | 13 | 9 | 3 | 0 | 0 | 4 | 0 | 0 | no (from Research) | 6 |
| 10-29 | Thu 13:43 | 96 | 9 | 19 | 10 | 13 | 10 | 3 | 0 | 1 | 3 | 0 | 0 | no (#3) | 4 |
| 10-30 | Fri 10:05 | 86 | 2 | 18 | 9 | 13 | 9 | 4 | 0 | 2 | 7 | 2 | 0 | no (#4, fill-in) | 14 |
| 11-02 | Mon 10:38 | 47 | 0 | 22 | 14 | 14 | 11 | 3 | 0 | 4 | 1 | 1 | 0 | no (#4, fill-in) | 8 |
| 11-03 | Tue 12:39 | 55 | 4 | 19 | 12 | 13 | 11 | 2 | 0 | 1 | 2 | 0 | 0 | no (#3) | 4 |
| 11-04 | Wed 10:40 | 71 | 11 | 16 | 11 | 12 | 10 | 2 | 1 | 0 | 1 | 1 | 0 | no (#3) | 4 |
| **Total** | | **793** | **87** | **163** | **104** | **122** | **94** | **27** | **3** | **11** | **31** | **4** | **0** | **2 of 10** | |
| **Median** | | 71 | 10 | 16.5 | 10 | 12.5 | 9.5 | 3 | 0 | 1 | 3 | 0 | 0 | | 5.5 |

- **Shown vs approved:** 163 shown and 122 approved (75%). The reviewer chose from a median 16.5 visible
  stories (range 12 to 22).
- **Approved vs default:**
  - 94 of 122 approved stories (77%) were default-selected, and 77 of 122 (63%) were default-selected in
    the same section.
  - 10 of the 104 default-selected stories were dropped: 7 by exclusion and 3 by demotion.
  - No commit matched the default exactly.
- **Headline text:** 0 edits. The board UI cannot edit headline text, so no rewrites show up in this data.
- **10-22:** the commit went through, but issue 260 was never published, so its stories were never marked
  used.

### 2.2 Section balance

Default-selected and approved counts per section, summed over the 10 commits:

| Section | Slot design (selected / fill-in) | Default selected | Approved | Approved per commit |
|---|---|---|---|---|
| Top Stories | 3 / 3 | 27 | 29 | 2.9 |
| Research | 4 / 3 | 37 | 35 | 3.5 |
| Tools | 3 / 3 | 25 | 26 | 2.6 |
| Quick Hits | 6 / 3 | 15 | 32 | 3.2 |

- Quick Hits is the starved section. It draws from general[6:15], which dedup and the 3-day pool often empty
  out: the default averaged 1.5 per board, never filled all 6, and the reviewer roughly doubles it.

### 2.3 Moves (31 in 10 commits)

| From (default) | To (approved) | Count |
|---|---|---|
| Top Stories (selected) | Quick Hits | 12 |
| Tools (selected 5, fill-in 2) | Quick Hits | 7 |
| Tools | Top Stories | 4 |
| Top Stories | Tools | 3 |
| Research | Top Stories | 2 |
| Other pairs | | 1 each |

- The keyword bucketing sends any non-research, non-tool story to "general". General feeds both Top Stories
  and Quick Hits, so the 3 Top Story slots get filled by score alone. The reviewer then pushes smaller items
  down to Quick Hits and pulls big launches up from Tools.
- Moves land at the end of the target section, so a move also changes order.

### 2.4 Exclusions (11)

All 11 had an empty reason. The board does not store a reason, so I inferred each one by matching against
published issues.

| Cause | Count | Detail |
|---|---|---|
| Repeat of a story already published 2 to 6 days earlier | 8 | Anthropic IPO x3 (published 10-27), Gemini 4 Carbon x3 (published 10-29), Genie 4 (published 10-28), PHP vulnerabilities (published 10-23). 3 had the exact same URL as the published story. |
| Same-day duplicate from another source | 1 | OpenAI funding target: The Signal version excluded, AI Breakfast version approved (11-03) |
| Already in an earlier, unpublished draft | 1 | Laminar (approved on 10-22, the draft that was never published) |
| Editorial judgment | 1 | SAP Tabular AI |

- **Sources:** 5 of the 11 came from The Signal and 2 from Product Hunt. 7 of the 11 had been
  default-selected.
- **Why the repeats get through:** the AI dedup compares against only the last 2 published days (3 on
  Mondays). Story-level guid dedup only catches the same URL on the same day. A re-report 3 to 6 days later
  goes straight onto the board.

### 2.5 URL edits and notes

- **URL edits:** 4 in the archive, all on approved stories. Each replaced a paywalled link with a free copy:
  - WSJ to Yahoo Finance;
  - NYT to Yahoo Finance, twice;
  - Axios to CTV.

  One of them (11-02) looks like a wrong paste. It replaced an Axios OpenAI policy link with a Yahoo article
  about Microsoft agents.
- **History:** a guid that no longer matches its url marks a reviewer URL edit, and every mismatch since July
  is on a board-shown story:

  | Story month | Stories | Shown on a committed board | URL edits (guid mismatch) | Excluded | Notes with text |
  |---|---|---|---|---|---|
  | 2026-06 | 606 | 328 | 445 (guid formula changed late June, not edits) | 16 | 1 |
  | 2026-07 | 884 | 334 | 18 | 11 | 1 |
  | 2026-08 | 732 | 301 | 26 | 7 | 0 |
  | 2026-09 | 826 | 287 | 18 | 9 | 0 |
  | 2026-10 | 870 | 302 | 5 | 11 | 0 |
  | 2026-11 (4 days) | 98 | 42 | 2 | 4 | 0 |

  That is roughly 1 URL edit per issue in summer and fewer since October.
- **Notes:** almost never used. Only 3 notes with text exist in the whole table:
  - 2026-05-28: context on Cognition/Devin;
  - 2026-06-17: iOS capitalization;
  - 2026-07-15: "don't mention Bloomberg".

  The `note IS NOT NULL` marker is set to `''` for every visible story when a draft is created, so it marks
  "shown on a committed board", not "annotated".

### 2.6 Time from ping to commit

**Archive** (the ping fires 09:55:51 to 09:57:36 ET):

| Date | Ping to commit (min) | Stories touched |
|---|---|---|
| 10-22 | 135 | 4 |
| 10-23 | 3 | 7 |
| 10-26 | 115 | 9 |
| 10-27 | 104 | 5 |
| 10-28 | 188 | 6 |
| 10-29 | 227 | 4 |
| 10-30 | 9 (first attempt; the replay came later) | 14 |
| 11-02 | 42 | 8 |
| 11-03 | 163 | 4 |
| 11-04 | 45 | 4 |

- **Summary:** median 110 min, and 5 of 10 commits came after 11:40. From commit to the issue row being
  created takes 1 to 6 min.
- **Edits are not the bottleneck.** The two fastest commits had 7 and 14 stories touched, and the slowest
  had 4. Edit count and wait time show no relationship.

**History from the DB (2026-05-14 to 11-04).** This uses a proxy for the ping: the last story `createdAt`
between 09:30 and 10:30 ET. It runs from the ping to the first issue row of the day. 102 same-day dates had
both; backfilled dates are excluded.

| Statistic | Minutes |
|---|---|
| Median | 88 |
| p25 | 38 |
| p75 | 166 |
| Min / max | 5 / 729 |
| Dates over 4 h | 12 |

| Weekday | Mon | Tue | Wed | Thu | Fri |
|---|---|---|---|---|---|
| Median min | 73 | 110 | 103 | 93 | 66 |

| Month | May | Jun | Jul | Aug | Sep | Oct | Nov (3 dates) |
|---|---|---|---|---|---|---|---|
| Median min | 80 | 111 | 51 | 61 | 76 | 155 | 46 |

- **Draft creation** mostly happens between 10:00 and 11:59.
- **Draft to publish:** the median is 32 min, and publishing mostly happens between 10:00 and 14:59.

### 2.7 Commits per date

- **Archive:** 1 reviewer commit per date. The only second execution is the manual replay of the failed
  10-30 commit.
- **DB since 2026-05-14:** 8 of 110 dates had 2 or 3 issue rows. This is a lower bound, because 74 issue rows
  have been deleted over time. 8 dates have no published issue.
- **Approved vs published:** 1,360 stories queued and 1,338 published, with 1,329 in both. 9 were published
  but not queued, and 31 were queued but not published. The approved set is what goes out.

### 2.8 Longer history: default pre-selection vs what was published

This rebuilds the default board for each same-day issue from 2026-07-01 to 11-04 (64 issues, 839 published
stories) and checks where each published story sat. The rebuild ignores the AI dedup step, because the ids
it keeps are not stored.

| Where the published story sat in the default | Share |
|---|---|
| Default-selected (any section) | 80% |
| Default-selected in the same section | 76% |
| Fill-in (promoted) | 18% |
| Outside all 28 slots | 2% |

| Section | Published story was default-selected in that section |
|---|---|
| Research | 93% |
| Tools | 82% |
| Top Stories | 67% |
| Quick Hits | 64% |

| Month | Jul | Aug | Sep | Oct | Nov |
|---|---|---|---|---|---|
| Default-selected | 78% | 82% | 83% | 74% | 82% |

- Research is close to "accept as is" already. Top Stories and Quick Hits carry most of the editing.

### 2.9 Conclusion for Q1

**Why approval is slow:**

1. **Reviewer availability.** Most of the 1.5 to 2 h median is time before the reviewer opens the board.
   The editing takes minutes: one commit came 3 min after the ping with 7 stories changed.
2. **The board is not a finished issue.** About 3 in 10 slot stories disappear in dedup with no backfill.
   Quick Hits is nearly empty by default. The reviewer has to promote about 3 fill-ins per day.
3. **Wrong section roles.** About 3 moves per board come from keyword bucketing. The biggest flows are Top
   Stories to Quick Hits and Tools to Quick Hits or Top Stories.
4. **No proposed lead.** The default #1 became the lead in only 2 of 10 commits.
5. **Stale repeats.** The 2-day dedup window lets re-reports from The Signal and AI Breakfast through.
6. **Paywalled links.** These need a manual swap about once per issue in summer, less often now.
7. **No feedback captured.** Exclusion reasons are discarded and notes are unused, so the system cannot
   learn from the reviewer.

**What a system must propose for "accept as is":**

- **A full issue sized like the typical approved one:** about 12 to 13 stories, roughly 3 Top Stories, 3 to 4
  Research, 3 Tools and 3 to 6 Quick Hits, backfilled after dedup.
- **A proposed lead.**
- **Dedup against at least 7 to 10 days** of published stories plus approved-but-unpublished drafts, by URL
  and by meaning.
- **Sections chosen by editorial role:** big launches and funding go to Top Stories, smaller updates go to
  Quick Hits, and dev tools go to Tools.
- **Coverage by several sources as a Top Stories signal** (see Q3).
- **A free URL** when the chosen one is paywalled, taken from another source's link for the same story.
- **One-tap accept,** with reason codes on exclude and move, to measure how often the proposal is accepted.

## 3. Q2: When the newsletters arrive

### 3.1 Gmail receipt times (archive, `x-received`, ET)

The archive covers 10 weekday runs from 10-22 to 11-04. Each Gmail node fetches the latest message
(limit 1). An email that arrives after the run is only seen in the next run. Its `x-received` time is still
the real arrival time.

| Source | Days seen | Arrival times | Typical | Spread | Before the 09:55 run? |
|---|---|---|---|---|---|
| Rundown | Mon to Fri, plus a Sunday edition (10-25) | 06:04 to 06:11 | 06:08 | 6 min | always |
| AlphaSignal | Mon to Fri | 09:04 to 09:14 | 09:12 | 10 min | always, about 40 min before |
| TLDR | Tue to Fri, never Mondays | Tue 09:36 to 09:37; Wed to Fri 09:52 to 09:54 | 09:53 | 18 min | yes, but only 1 to 3 min before on Wed to Fri |
| AI Breakfast | Mon, Wed, Fri only | Fri 09:41 and 10:07; Wed 11:39; Mon 12:20 and 12:22 | 11:39 | 161 min | 1 of 5 |
| The Signal | irregular, 2 to 3 per week | Fri 10-23 09:16; Sun 10-25 10:19; Wed 10-28 10:09; Sun 11-01 11:22 | about 10:15 | about 2 h | 1 of 2 weekday editions |
| Aloa | none | dead since 2026-04-27. A 2026-03-26 sample arrived at 10:43. | n/a | n/a | n/a |

- **The Signal** (Substack): the `Date` header is about 9 min earlier than receipt. All other sources show
  no lag.
- **TLDR on Mondays:** never captured in the archive (10-26 and 11-02 both missed). Since July the DB has TLDR
  stories on only 9 of about 18 Mondays. Either the Monday edition arrives after 09:55, or Tuesday's email
  replaces it before the next run reads it. With limit 1, the archive cannot tell which.

### 3.2 How many Gmail sources are in by each cutoff

The table counts per weekday in the archive, out of the 6 Gmail sources, of which 5 are alive.

| Cutoff (ET) | 10-22 | 10-23 | 10-26 | 10-27 | 10-28 | 10-29 | 10-30 | 11-02 | 11-03 | 11-04 | Median |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 06:00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 07:00 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 08:00 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 09:00 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 09:30 | 2 | 3 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| 09:55 | 3 | 5 | 2 | 3 | 3 | 3 | 3 | 2 | 3 | 3 | 3 |
| 10:00 | 3 | 5 | 2 | 3 | 3 | 3 | 3 | 2 | 3 | 3 | 3 |
| 11:00 | 3 | 5 | 2 | 3 | 4 | 3 | 4 | 2 | 3 | 3 | 3 |
| 12:00 | 3 | 5 | 2 | 3 | 5 | 3 | 4 | 2 | 3 | 3 | 3 |
| 13:00 | 3 | 5 | 3 | 3 | 5 | 3 | 4 | 3 | 3 | 3 | 3 |

- 06:00 to 09:00 means Rundown only. 09:30 adds AlphaSignal. 10:00 adds TLDR on Tue to Fri, and sometimes
  AI Breakfast or The Signal. By 13:00, AI Breakfast is in on Mondays, Wednesdays and Fridays.

### 3.3 DB secondary signal (since 2026-07-01)

`createdAt` only shows when the 09:55 run stored a story, not when the email arrived. Its use is to show
whether a source made it into the same day's run.

| Source (normalized) | Weekdays present | Ingested on the story day |
|---|---|---|
| Rundown | 85 | 81 |
| AlphaSignal | 82 | 79 |
| TLDR, Tue to Fri | 72 | 66 |
| TLDR, Mondays | 9 | 6 |
| AI Breakfast, Mon/Wed/Fri | 49 | 25 |
| Product Hunt | 87 | 87 |
| The Signal (`tldr_ai` from July) | 48 (Mon 15, Tue 12, Wed 8, Thu 5, Fri 8) | 41 |

- **Hugging Face** stories carry the paper's date, so the same-day test does not apply to them.

### 3.4 Product Hunt and Hugging Face

- **Product Hunt:**
  - At every 09:55 run, the newest feed item was published between 19:24 the previous evening and 02:46.
    Nothing newer shows up between about 03:00 and 09:55, so the overnight feed is complete well before the
    run.
  - Each run kept 4 to 11 items.
  - It has the lowest yield of any source (Q3).
- **Hugging Face:**
  - The daily-papers list for date D has `submittedOnDailyAt` = D 00:00 UTC, which is 19:00 or 20:00 ET on
    the previous evening, and it exists by 09:55.
  - It runs on weekdays only; on Mondays the previous date is Friday.
  - The top 5 is taken while upvotes are still coming in.
  - The papers' `publishedAt` is 1 to 7 days earlier.

### 3.5 Schedule history

| Period | First run of the day |
|---|---|
| From about 2026-03-25 | 09:45 |
| 2026-06-25 | 10:08 (one-off) |
| From 2026-07-01 | 09:55 |

- The Telegram ping lands at 09:55:51 to 09:57:36.

### 3.6 Implications

- **A single run at 09:55 is a compromise.** It gets Rundown, AlphaSignal, TLDR (on most Tue to Fri, by
  1 to 3 min), Product Hunt and Hugging Face. It misses AI Breakfast on about half of its days, TLDR on
  Mondays, and any edition of The Signal that lands after 09:55. Those only reach the next day's run, if the
  limit-1 fetch still sees them.
- **Moving the run earlier** (for example to 09:20) would lose TLDR and keep only Rundown and AlphaSignal
  from Gmail.
- **Running later** (12:30) catches everything but pushes approval past lunch.
- **The better fit is per-source ingestion:** on arrival, or a few short runs at 06:15, 09:20, 10:00 and
  12:30. The board then updates as stories come in, and a late source adds candidates instead of being
  lost.

## 4. Q3: Which sources end up in issues

### 4.1 Scope

- **Issues:** 160 published issues have `content_json`, and 153 of them carry story ids (2026-03-03 to
  11-04).
- **Formats:** v2 issues use `headlines`, `research_and_analysis`, `tools` and `quick_hits` with `story_id`.
  v1 issues use `topStories`, `research`, `tools` and `quickHits` with `data-story-id`.
- **Coverage:** 2,022 story slots, 2,011 distinct stories, 0 ids with no matching story.

### 4.2 All-time by source

| Source | Stories | Share | Top Stories | Research | Tools | Quick Hits | Active |
|---|---|---|---|---|---|---|---|
| TLDR | 598 | 29.6% | 133 | 160 | 114 | 191 | all period |
| Rundown | 436 | 21.6% | 110 | 67 | 67 | 192 | all period |
| AI Breakfast | 356 | 17.6% | 112 | 45 | 73 | 126 | all period |
| AlphaSignal | 215 | 10.6% | 44 | 58 | 89 | 24 | from 2026-06-25 |
| Hugging Face | 148 | 7.3% | 1 | 138 | 2 | 7 | from 2026-06-26 |
| Product Hunt | 99 | 4.9% | 8 | 1 | 52 | 38 | all period |
| Aloa | 87 | 4.3% | 9 | 6 | 6 | 66 | to 2026-04-27 |
| The Signal | 83 | 4.1% | 31 | 5 | 18 | 29 | mostly from July |
| **Total** | **2,022** | | **448** | **480** | **421** | **673** | |

### 4.3 Share of each section by source (%)

| Period | Section | n | TLDR | Rundown | AI Breakfast | AlphaSignal | Hugging Face | Product Hunt | The Signal | Aloa |
|---|---|---|---|---|---|---|---|---|---|---|
| All | Top Stories | 448 | 30 | 25 | 25 | 10 | 0 | 2 | 7 | 2 |
| All | Research | 480 | 33 | 14 | 9 | 12 | 29 | 0 | 1 | 1 |
| All | Tools | 421 | 27 | 16 | 17 | 21 | 0 | 12 | 4 | 1 |
| All | Quick Hits | 673 | 28 | 29 | 19 | 4 | 1 | 6 | 4 | 10 |
| Last 8 weeks (from 09-09) | Top Stories | 103 | 32 | 16 | 24 | 19 | 1 | 2 | 6 | 0 |
| Last 8 weeks | Research | 126 | 7 | 8 | 5 | 21 | 57 | 0 | 2 | 0 |
| Last 8 weeks | Tools | 86 | 19 | 10 | 14 | 44 | 1 | 5 | 7 | 0 |
| Last 8 weeks | Quick Hits | 123 | 26 | 24 | 22 | 7 | 2 | 6 | 14 | 0 |

- **Top Stories** comes from TLDR, AI Breakfast, AlphaSignal and Rundown.
- **Research** is now mostly Hugging Face plus AlphaSignal.
- **Tools** is mostly AlphaSignal.
- **Quick Hits** is spread across the newsletters.

### 4.4 Weekly trend, last 8 weeks (share of published stories, %)

| Week of | Issues | Stories | TLDR | Rundown | AI Breakfast | AlphaSignal | Hugging Face | Product Hunt | The Signal |
|---|---|---|---|---|---|---|---|---|---|
| 09-07 | 5 | 54 | 20 | 17 | 22 | 15 | 13 | 7 | 6 |
| 09-14 | 5 | 64 | 28 | 13 | 22 | 17 | 14 | 2 | 5 |
| 09-21 | 3 | 33 | 27 | 9 | 12 | 30 | 15 | 3 | 3 |
| 09-28 | 5 | 56 | 23 | 21 | 9 | 21 | 18 | 4 | 4 |
| 10-05 (backfilled issues) | 5 | 69 | 13 | 10 | 12 | 22 | 25 | 0 | 19 |
| 10-12 | 4 | 49 | 16 | 31 | 20 | 14 | 12 | 2 | 4 |
| 10-19 | 3 | 34 | 12 | 3 | 24 | 21 | 24 | 0 | 18 |
| 10-26 | 5 | 60 | 18 | 13 | 18 | 25 | 15 | 3 | 7 |
| 11-02 (partial) | 3 | 39 | 23 | 13 | 18 | 28 | 13 | 5 | 0 |

- **Trend:** AlphaSignal and Hugging Face have grown to about 20% and 15% to 25% a week. TLDR and Rundown
  swing week to week.
- **Product Hunt** is close to zero.
- **The Signal** is spiky (0% to 19% a week).

### 4.5 Yield, last 8 weeks (from 09-07, 38 issues, 458 slots)

| Source | Ingested (created since 09-07) | Published | Share of published | Yield (published / ingested) |
|---|---|---|---|---|
| AlphaSignal | 263 | 96 | 21.0% | 36.5% |
| TLDR | 362 | 92 | 20.1% | 25.4% |
| AI Breakfast | 241 | 79 | 17.2% | 32.8% |
| Hugging Face | 214 | 76 | 16.6% | 35.5% |
| Rundown | 182 | 68 | 14.8% | 37.4% |
| The Signal | 114 | 34 | 7.4% | 29.8% |
| Product Hunt | 291 | 13 | 2.8% | 4.5% |

- Product Hunt makes up 18% of ingested stories but only 3% of published ones.

### 4.6 Attribution caveat (last-writer-wins)

- **Why labels drift:** the upsert is `ON CONFLICT (guid)`, and guid is `md5(day || url)`. When two sources
  report the same URL on the same day, they share one row, and `source` keeps the label of whichever source
  was extracted last. The extraction order is Rundown, Aloa, The Signal, AI Breakfast, TLDR, Product Hunt,
  AlphaSignal, Hugging Face.
- **Impact in the archive window:** of the 110 stories published from 10-22 to 11-04, 10 rows had more than
  one contributing source. The table below compares the DB label with crediting every source that extracted
  the row:

  | Source | DB label | Credit to any contributing source |
  |---|---|---|
  | AlphaSignal | 28 | 30 |
  | TLDR | 21 | 27 |
  | AI Breakfast | 22 | 21 |
  | Hugging Face | 17 | 17 |
  | Rundown | 14 | 20 |

- **Effect on the tables above:** they under-credit Rundown and TLDR, the sources most often overwritten by
  a later source, by a few points.

### 4.7 Same story from 2+ sources

**Same day, archive (exact).** The data is the 413 extracted rows from the 63 archived extraction runs (10
days), clustered by normalized URL or near-identical headline:

| Measure | Value |
|---|---|
| Story clusters | 381 |
| Clusters from 2+ sources | 23 (6.0%): 16 from 2 sources, 7 from 3 |
| Per day | 2.3, on 9 of 10 days |
| Shared the exact URL (merged into one DB row) | 19 of 23 |
| Most common pairs | Rundown and TLDR 15, AlphaSignal and Rundown 8, AlphaSignal and TLDR 7 |
| Published rate | 43% multi-source vs 29% single-source |
| Placed in Top Stories when published | 8 of 10 multi-source vs 20 of 104 single-source |

**Same day, DB (lower bound).** Over the same 10 days the DB shows 6 multi-source clusters, against 23 in
the archive. Since July or September the DB shows 0.6 per day (1.6% to 1.8% of clusters). The DB undercounts
because exact-URL matches are already merged into one row. Even so, multi-source clusters were published at
68% to 74%, against 26% to 27% for single-source ones.

**Across days (archive).**

- 21 clusters were seen on 2 or more run days.
- 9 stories that were already published came back on later days. The Signal re-reported 11 such rows and
  AI Breakfast 6.
- This is the same pattern as the exclusions in section 2.4.

### 4.8 Conclusion for Q3

- **The newsletters overlap little on the same day.** About 6% of stories come from 2+ sources, but those
  are the big stories. They are published more often and usually lead.
- **Overlap is a useful ranking signal,** but the current schema destroys it. A rebuilt store should keep one
  story with many source mentions (story to mentions), not a single `source` column.
- **Week-old re-reports** from The Signal and AI Breakfast are the larger problem for approval.
- **Product Hunt** adds 18% of ingested stories but only 3% of published ones. **Hugging Face and
  AlphaSignal** now carry Research and Tools.

## 5. Caveats

- **Small archive.** It holds only 10 reviewer commits from two weeks. The DB history (sections 2.5 to 2.8)
  covers the longer period, but it cannot see moves or demotions.
- **Dedup outcome not stored.** The AI dedup step does not save which ids it kept. The per-commit rebuild
  reruns the board query as of commit time and infers dedup removals from the visible set in the commit. The
  history rebuild (2.8) ignores dedup.
- **Rebuild assumptions.** The as-of-commit rebuild assumes:
  - a story was used once its issue's `published_at` was before the commit;
  - a story was excluded if an earlier archived commit excluded it, or if it was excluded before the archive.

  Two later re-upserts changed scores (2 mismatches on 10-28), and story 10832 could not be placed.
- **Last-writer-wins labels** under-credit some sources (4.6).
- **Limit-1 Gmail fetches** hide emails that arrive between runs, so TLDR's Monday timing is unknown (3.1).
- **Backfills excluded.** The backfilled issues from 2026-10-01 to 10-12 have `created_at` days after
  `issue_date` and `published_at` at midnight. I excluded them from latency and default-vs-published. They
  remain in the Q3 source shares (the 10-05 week).
- **Deleted issue rows.** 74 issue rows have been deleted over time, so re-commit counts are a lower bound.
- **Unreliable `day` field.** Hugging Face and some The Signal rows carry the email or paper date rather than
  the run date.

## Appendix A: How to re-run

**Tools:**

- **Database:** `db_ro.sh prod "<SQL>"`, a read-only Neon connection with writes blocked. The wrapper rejects
  the words begin, commit, rollback and end, so the queries avoid CASE and use VALUES tables and FILTER.
- **Python:** `python3 -I`, with standard library only.
- **Script folder:** the job's `scratch/analysis/scripts/`.

### A.1 DB exports used by the Python scripts

```sql
COPY (SELECT id, guid, to_char(day,'YYYY-MM-DD') AS day_s, headline, url, summary, category, source,
             "createdAt" AS created_at, "updatedAt" AS updated_at, story_details, importance_score,
             to_char(used_in_publication_date,'YYYY-MM-DD') AS used_date,
             to_char(queued_for_publication_date,'YYYY-MM-DD') AS queued_date,
             exclude_from_candidates, note, paywall_detected
      FROM newsletter.stories ORDER BY id)
TO STDOUT WITH (FORMAT csv, HEADER, NULL 'NULLVAL');

COPY (SELECT id, title, published_at, created_at, to_char(issue_date,'YYYY-MM-DD') AS issue_date, content_json
      FROM newsletter.issues ORDER BY id)
TO STDOUT WITH (FORMAT csv, HEADER, NULL 'NULLVAL');
```

`NULL 'NULLVAL'` keeps SQL NULL apart from `''`. This matters for `note`.

### A.2 Q3 base CTEs (`q3_base.sql`)

```sql
WITH src_map(raw, canon, valid_from, valid_to) AS (VALUES
  ('rundown_ai','Rundown','-infinity'::timestamptz,'infinity'::timestamptz),
  ('rundown','Rundown','-infinity','infinity'), ('Rundown','Rundown','-infinity','infinity'),
  ('aloa','Aloa','-infinity','infinity'), ('aloa_ai','Aloa','-infinity','infinity'), ('bytesizedata','Aloa','-infinity','infinity'),
  ('ai_breakfast','AI Breakfast','-infinity','infinity'), ('beehiiv','AI Breakfast','-infinity','infinity'),
  ('beehiiv_ai_breakfast','AI Breakfast','-infinity','infinity'),
  ('the_signal','The Signal','-infinity','infinity'),
  ('tldr','TLDR','-infinity','infinity'),
  ('tldr_ai','TLDR','-infinity','2026-07-01 04:00+00'),
  ('tldr_ai','The Signal','2026-07-01 04:00+00','infinity'),
  ('alphasignal','AlphaSignal','-infinity','infinity'),
  ('product_hunt_ai','Product Hunt','-infinity','infinity'),
  ('huggingface','Hugging Face','-infinity','infinity')
),
sec_map(json_key, section) AS (VALUES
  ('headlines','headlines'), ('research_and_analysis','research'), ('tools','tools'), ('quick_hits','quick_hits'),
  ('topStories','headlines'), ('research','research'), ('quickHits','quick_hits')
),
items AS (
  SELECT i.id AS issue_id, i.issue_date, sm.section,
         coalesce(e->>'story_id', e->>'data-story-id')::int AS story_id
  FROM newsletter.issues i
  CROSS JOIN sec_map sm
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(i.content_json->sm.json_key, '[]'::jsonb)) e
  WHERE i.published_at IS NOT NULL AND i.content_json IS NOT NULL
    AND coalesce(e->>'story_id', e->>'data-story-id') ~ '^[0-9]+$'
),
pub AS (
  SELECT it.*, s.source AS raw_source, coalesce(m.canon, 'unmapped:' || coalesce(s.source, 'missing story')) AS source
  FROM items it
  LEFT JOIN newsletter.stories s ON s.id = it.story_id
  LEFT JOIN src_map m ON m.raw = s.source AND s."createdAt" >= m.valid_from AND s."createdAt" < m.valid_to
)
```

Each query below is appended to this block (`python3 -I run_sql.py q3_base.sql q3_<name>.sql`).

**Totals (4.1):**

```sql
SELECT count(*) AS story_slots, count(DISTINCT story_id) AS distinct_stories, count(DISTINCT issue_id) AS issues,
       min(issue_date) AS first_issue, max(issue_date) AS last_issue,
       count(*) FILTER (WHERE issue_date >= date '2026-09-07') AS slots_l8w,
       count(DISTINCT issue_id) FILTER (WHERE issue_date >= date '2026-09-07') AS issues_l8w,
       count(*) FILTER (WHERE raw_source IS NULL) AS unmatched_story_ids
FROM pub;
```

**By source (4.2):**

```sql
SELECT source, count(*) AS n, round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct,
       count(*) FILTER (WHERE section = 'headlines') AS headlines,
       count(*) FILTER (WHERE section = 'research') AS research,
       count(*) FILTER (WHERE section = 'tools') AS tools,
       count(*) FILTER (WHERE section = 'quick_hits') AS quick_hits,
       count(DISTINCT issue_id) AS issues, min(issue_date) AS first_issue, max(issue_date) AS last_issue
FROM pub GROUP BY 1 ORDER BY 2 DESC;
```

**Section share (4.3):**

```sql
SELECT period, section, count(*) AS n,
       round(100.0 * count(*) FILTER (WHERE source = 'TLDR') / count(*)) AS tldr,
       round(100.0 * count(*) FILTER (WHERE source = 'Rundown') / count(*)) AS rundown,
       round(100.0 * count(*) FILTER (WHERE source = 'AI Breakfast') / count(*)) AS ai_breakfast,
       round(100.0 * count(*) FILTER (WHERE source = 'AlphaSignal') / count(*)) AS alphasignal,
       round(100.0 * count(*) FILTER (WHERE source = 'Hugging Face') / count(*)) AS hf,
       round(100.0 * count(*) FILTER (WHERE source = 'Product Hunt') / count(*)) AS ph,
       round(100.0 * count(*) FILTER (WHERE source = 'The Signal') / count(*)) AS signal,
       round(100.0 * count(*) FILTER (WHERE source = 'Aloa') / count(*)) AS aloa
FROM (SELECT 'ALL' AS period, * FROM pub
      UNION ALL SELECT 'L8W', * FROM pub WHERE issue_date >= date '2026-11-04' - 56) x
GROUP BY 1, 2 ORDER BY 1, 2;
```

**Weekly trend (4.4):** this is the same FILTER pattern, grouped by week.

```sql
SELECT date_trunc('week', issue_date)::date AS week, count(DISTINCT issue_id) AS issues, count(*) AS stories,
       round(100.0 * count(*) FILTER (WHERE source = 'TLDR') / count(*)) AS tldr_pct,
       round(100.0 * count(*) FILTER (WHERE source = 'Rundown') / count(*)) AS rundown_pct,
       round(100.0 * count(*) FILTER (WHERE source = 'AI Breakfast') / count(*)) AS ai_breakfast_pct,
       round(100.0 * count(*) FILTER (WHERE source = 'AlphaSignal') / count(*)) AS alphasignal_pct,
       round(100.0 * count(*) FILTER (WHERE source = 'Hugging Face') / count(*)) AS hf_pct,
       round(100.0 * count(*) FILTER (WHERE source = 'Product Hunt') / count(*)) AS ph_pct,
       round(100.0 * count(*) FILTER (WHERE source = 'The Signal') / count(*)) AS signal_pct,
       round(100.0 * count(*) FILTER (WHERE source = 'Aloa') / count(*)) AS aloa_pct
FROM pub
WHERE issue_date >= date '2026-11-04' - 8 * 7 - 2
GROUP BY 1 ORDER BY 1;
```

**Yield (4.5):** this is appended to `q3_base_cte.sql`, which is the same CTE block, so it starts with a
comma.

```sql
, ingested AS (
  SELECT coalesce(m.canon, s.source) AS source, count(*) AS ingested,
         count(*) FILTER (WHERE s.importance_score >= 2) AS ingested_score2
  FROM newsletter.stories s
  LEFT JOIN src_map m ON m.raw = s.source AND s."createdAt" >= m.valid_from AND s."createdAt" < m.valid_to
  WHERE s."createdAt" >= timestamptz '2026-09-07 00:00 America/New_York'
  GROUP BY 1
), published AS (
  SELECT source, count(*) AS published FROM pub WHERE issue_date >= date '2026-09-07' GROUP BY 1
)
SELECT i.source, i.ingested, i.ingested_score2, coalesce(p.published, 0) AS published,
       round(100.0 * coalesce(p.published, 0) / sum(coalesce(p.published, 0)) OVER (), 1) AS pct_of_published,
       round(100.0 * coalesce(p.published, 0) / i.ingested, 1) AS yield_pct
FROM ingested i LEFT JOIN published p USING (source)
ORDER BY published DESC;
```

### A.3 URL edits, exclusions and notes by month (2.5)

```sql
SELECT to_char(day, 'YYYY-MM') AS month,
       count(*) AS stories,
       count(*) FILTER (WHERE note IS NOT NULL) AS shown_on_committed_board,
       count(*) FILTER (WHERE guid <> md5(to_char(day, 'YYYY-MM-DD') || ' || ' || coalesce(url, ''))) AS guid_mismatch,
       count(*) FILTER (WHERE guid <> md5(to_char(day, 'YYYY-MM-DD') || ' || ' || coalesce(url, '')) AND note IS NOT NULL) AS mismatch_and_shown,
       count(*) FILTER (WHERE exclude_from_candidates) AS excluded,
       count(*) FILTER (WHERE coalesce(note, '') <> '') AS notes_with_text
FROM newsletter.stories
WHERE day >= date '2026-06-01'
GROUP BY 1 ORDER BY 1;
```

### A.4 DB arrival signal (3.3)

```sql
WITH per_day AS (
  SELECT source, day,
         percentile_disc(0.5) WITHIN GROUP (ORDER BY "createdAt" AT TIME ZONE 'America/New_York') AS median_created_et,
         count(*) AS n
  FROM newsletter.stories
  WHERE day >= date '2026-07-01' AND extract(isodow FROM day) <= 5
  GROUP BY 1, 2
)
SELECT source, extract(isodow FROM day)::int AS isodow, count(*) AS weekdays_present,
       count(*) FILTER (WHERE median_created_et::date = day) AS same_day,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY median_created_et::time) AS typical_time_et
FROM per_day
GROUP BY 1, 2 ORDER BY 1, 2;
```

- Use the median, not `min("createdAt")`. A guid collision can attach a row to a source a day early.

### A.5 Q1 rebuild (Python)

**Scripts:**

| Script | Purpose |
|---|---|
| `curation.py` | Port of `curation.service.ts` |
| `q1_commits.py` | Per-commit rebuild and diff; writes `q1_commits.json` |
| `q1_detail.py`, `q1_excl_url.py` | Exclusion and URL-edit detail |
| `q1_tables.py` | Section 2.1 table |
| `q1_history.py` | Latency and re-commits; argument is the start date, default 2026-05-14 |
| `q1_history_default.py` | Section 2.8 |

**Steps:**

1. **Extract commit bodies.** For each `2-public-approval-page` execution, take
   `.data.resultData.runData.Webhook[0].data.main[0][0].json.body` with jq. Then drop 21275, the replay of
   21269.
2. **Rebuild the pool as of commit time T for date D.** Include a story if all of these hold:
   - `createdAt <= T`;
   - `importance_score >= 2`;
   - `day` between D-3 and D;
   - it is not used, meaning its containing issue had no `published_at` before T;
   - it is not excluded, meaning no earlier archived commit excluded it and it was not already excluded
     before the archive window;
   - its URL does not contain tldr, rundown or beehiiv;
   - it survives guid dedup.

   Order by `day DESC, id DESC`.
3. **Rank** as in `curation.service.ts`:
   - apply `cleanText`. The JS regex `[^.!?\\n]` excludes the letter n, and the port keeps that quirk;
   - compute the keyword score from 24 tool and 18 research substring keywords;
   - `combined = importance + keyword`, then a stable sort by combined, importance and keyword.
4. **Bucket and slot.** Research or analysis goes to research; tools or tool goes to tools; everything else
   goes to general. Then apply the blueprint in section 1.
5. **Infer dedup.** Any slot story not visible in the commit counts as removed by AI dedup.
6. **Diff against the commit.** Compare approved ids per section, `excluded_ids`, notes, URLs and the lead to
   get promoted, demoted, excluded, moved and URL-edit counts. URL edits are commit URLs that differ from the
   stored URL as of T, cross-checked with the guid mismatch.
7. **Latency.** Ping time is the Telegram node's `result.date` in the matching Fetch Stories run, and commit
   time is the webhook execution start. For history, see 2.6.

### A.6 Q2 Gmail times

- **Script:** `gmail_times.py` reads `1-fetch-stories/*.json`, and `q2_summary.py` turns the output into
  tables.
- **Gmail items:** for each Gmail node's items, parse the timestamp in `headers['x-received']` (the items have
  no `internalDate`) and the `Date` header. Convert to ET, and dedupe by Gmail message id across runs.
  Execution 12947 is skipped.
- **Ping time:** the Telegram node's `result.date`.
- **Cutoff counts:** for each archive weekday and cutoff, count the sources with an email received that day
  at or before the cutoff.
- **Product Hunt and Hugging Face:** `ph_hf_times.py` reads feed item `pubDate` and `submittedOnDailyAt` and
  `publishedAt` from the same runs.

### A.7 Multi-source clustering (4.6, 4.7)

**Scripts:**

| Script | Purpose |
|---|---|
| `q3_archive_extract.py` | Writes one row per story extracted by an `extract-and-store-v2` run, with its source and upsert id, to `archive_extracted.json` |
| `q3_multisource.py archive` | Archive mode |
| `q3_multisource.py db 2026-07-01` | DB mode, which groups by ingestion date in ET |
| `q3_multisource_lib.py` | Shared helpers |
| `q3_repeats.py` | Cross-day repeats |
| `q3_attrib.py` | Label vs any-source credit |

**Clustering:** union-find within a day, joining two rows if any of these hold:

- the normalized URLs match (lowercase, no scheme, no `www.`, no query or fragment, no trailing slash);
- the headline token Jaccard is at least 0.6, after stopwords are removed;
- the headline `SequenceMatcher` ratio is at least 0.85.

A cluster counts as multi-source when it has rows from 2 or more normalized sources.
