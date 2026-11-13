# Research: sampling live search sources (#86)

Run on **2026-11-12**. Price and API facts are in [live-news-and-job-runners.md](./live-news-and-job-runners.md)
(checked 2026-11-04). This doc adds measured results: what each search source found for 6 past issues, and what it
cost. Prompt and query tuning is a separate step, done with the owner (see [Tuning list](#tuning-list)).

## Summary

- **Pick Exa, not Perplexity, as the main search source.** This reverses the "Perplexity first" pick in
  [live-news-and-job-runners.md](./live-news-and-job-runners.md). Exa news queries plus first-party and publisher
  queries (16 calls a day), with Hacker News as a free extra, found **32 of 73 published stories and 9 of 16
  headlines** over 6 past issues. Perplexity Sonar found 9 of 73 and 4 of 16.
- **Cost: about $2.50 a month** for Exa (16 calls × $0.007 × 22 weekdays), or $0 inside Exa's $10 monthly free
  credit with a direct key. Grading with the extraction rubric on `gpt-6-luna` adds about $0.20 a month.
- **Live search brings news the newsletters never did:** about 20 results a day graded importance 4–5 that match
  no board story from 3 days before to 1 day after. Spot checks: AMD buying Taalas ($2.9B), Shield AI buying
  Echodyne ($5.3B), a Brazilian court ruling against Meta, Microsoft Maia 300, OpenAI–Oracle. This counts links,
  not events, so duplicates inflate it.
- **Leave out Grok `x_search` for now.** On 3 days it found 3 of 34 published stories and nothing new, for $0.085
  a call. X posts are only 6% of headlines.
- **Sonar is optional.** 3 calls a day cost about $0.20 a month and added 3 published stories and 1 headline the
  others missed, but it also returned old news as new (a "Gemini 1.5 Flash" launch).
- **Main quality problems to tune:** low-quality aggregator sites, the same event from many sites, old launches
  re-reported, non-English pages, and noise on company sites (support pages, customer stories, podcasts).

## Where published stories link to

Published stories from 2026-08-01 to 2026-11-06 (Neon `dev`): 720 stories, 164 of them headlines or leads.

| Link domain | Stories | Headlines or leads |
|---|---|---|
| openai.com | 52 | 22 |
| anthropic.com + claude.com (+ code., platform.) | 61 | 12 |
| blog.google + deepmind.google + cloud.google.com + research.google | 32 | 16 |
| testingcatalog.com | 13 | 9 |
| techcrunch.com | 33 | 8 |
| x.com + twitter.com | 42 | 10 |
| about.fb.com + research.meta.ai | 8 | 6 |
| fortune.com, venturebeat.com, cnbc.com, finance.yahoo.com, thenextweb.com | 25 | 12 |
| huggingface.co | 123 | 3 |
| arxiv.org | 34 | 0 |

What this means for live search:

- Company pages carry about a third of the headlines. A search that skips them misses the biggest stories, and
  Exa's `news` category skips them. They need their own plans, limited to those domains.
- A handful of publishers (TechCrunch, TestingCatalog, Fortune, VentureBeat, CNBC) carry most other headlines.
- X posts are about 6% of headlines. That caps what an X search can add.
- Papers (huggingface.co, arxiv.org) are a fifth of all stories but almost never headlines. The Hugging Face feed
  already brings them, so live search should not look for papers.

By newsletter, headlines came from TLDR (45), AI Breakfast (36), AlphaSignal (31), The Rundown (29), The Signal's
old `tldr_ai` key (17), Product Hunt (4) and Hugging Face (2).

## Access used

| Search source | Route | Status on 2026-11-12 |
|---|---|---|
| Exa `/search` | Composio CLI, `EXA_SEARCH` (billed by Composio, $0.007 per call) | Works |
| Perplexity Sonar | OpenRouter, `perplexity/sonar` with `search_after_date_filter` / `search_before_date_filter` | Works. The date filters hold. |
| Grok `x_search` | OpenRouter, `x-ai/grok-4.3` with `plugins: [{ id: "web", x_search: {...} }]` | Works |
| Hacker News | Algolia `search_by_date`, free | Works |
| Perplexity Search API (raw results) | Composio `perplexityai` (not linked), or a Perplexity key | Not tested |
| treg (Perplexity, Exa, X search on treg's keys) | treg MCP server and CLI | Not signed in (401) |

The repo's `OPENROUTER_API_KEY` covers Sonar, Grok and the judge, so no new account was needed.

## Method

The harness is [`evals/live-search/sample.ts`](../../evals/live-search/sample.ts). The search plans (queries,
prompts, X handles, excluded domains) are in [`evals/live-search/plans.ts`](../../evals/live-search/plans.ts),
built from the extraction prompt's categories and company tiers (`src/pipeline/ingest/extract.ts`).

For each issue date D:

1. **Window.** From 24 h before the previous weekday's 09:00 UTC run, to 09:00 UTC (about 05:00 ET) on D. Monday
   windows cover the weekend.
2. **Search.** Each search source runs its plans over the window. Results from other newsletters and roundup sites
   are dropped (`EXCLUDED_DOMAINS`), and so are results dated outside the window.
3. **Match.** A `gpt-6-luna` judge (OpenRouter) matches the results to (a) the stories the owner published on D,
   and (b) every board story from D − 3 to D + 1.
4. **Grade.** The same judge grades each result with the extraction rubric: kind (news, roundup, not AI, not
   news), category, and importance 1–5.

Metrics:

- **Published found**: published stories that at least one result reports.
- **Headlines found**: the same, for the headline section and the lead story.
- **Board 4+ found**: board stories with importance 4 or 5 (up to day D) that a result reports.
- **Strong new**: results graded news with importance 4 or 5 that match no board story from D − 3 to D + 1. This
  is news our newsletters never brought. It counts links, not events, so one event can count more than once.

Dates: 2026-10-20, 10-26 (Mon), 10-29, 11-02 (Mon), 11-04, 11-06. Grok ran on 10-26, 11-04 and 11-06 only.

### Limits of a backtest

- Search indexes are fuller now than at 05:00 ET on the day. Late articles and re-reports make a backtest look
  better than a live run. Treat the numbers as an upper bound.
- Hacker News points are today's totals, not the totals at 05:00 ET.
- The judge sees titles and links only, so some grades and matches are wrong. Spot checks agreed with most of
  them. 6 days is a small sample.

## Results

6 issue dates, one run each (2026-11-12, run folders `evals/data/live-search/2026-11-12T16-46-59-162Z` and
`…16-47-00-885Z`, local only).

| Search source | Calls a day | Results a day | Published found | Headlines found | Board 4+ found | Strong new a day |
|---|---|---|---|---|---|---|
| Exa news (`EXA_QUERIES`) | 10 | 96 | 22/73 | 6/16 | 37/167 | 14.5 |
| Exa first-party + publishers (`EXA_DOMAIN_PLANS`) | 6 | 58 | 22/73 | 6/16 | 29/167 | 4.2 |
| Hacker News | 1 (free) | 37 | 7/73 | 4/16 | 20/167 | 1.5 |
| Perplexity Sonar (`SONAR_FOCUSES`) | 3 | 18 | 9/73 | 4/16 | 13/167 | 1.2 |
| **Exa + first-party + Hacker News** | 17 | 181 | **32/73** | **9/16** | 61/167 | 19.5 |
| All four above | 20 | 198 | 35/73 | 10/16 | 64/167 | 20.7 |
| Grok `x_search` (3 dates, earlier run) | 1 | 3 | 3/34 | 1/7 | 2/82 | 0 |

Measured cost of these runs: Exa $0.112 a day, Sonar $0.0085 a day, Grok $0.085 a call, judge $0.017 a day (matching
and grading; production needs only grading).

### What the misses are

- **Research papers.** Hugging Face and arXiv items are most of the published misses. The Hugging Face feed already
  brings them. Live search should not try.
- **Company pages.** Before the first-party plans were added, Exa found 3 of 16 headlines: the `news` category leaves
  out openai.com, developer.apple.com and fireworks.ai/blog. The first-party plans raised it to 9 of 16.
- **Board recall stays low (61 of 167).** Much of the board is newsletter-only material: tool listings, Product
  Hunt launches, small funding rounds. Live search adds to the newsletters; it does not replace them.

### Which plans earn their cost

Result links matched to published stories, and links graded importance 4–5, summed over 6 days (60 results each
for an Exa plan):

| Plan | Published | Importance 4–5 | Of those, not on the board |
|---|---|---|---|
| Exa `anthropic` | 17 | 21 | 10 |
| Exa `google` | 12 | 34 | 11 |
| Exa `launches` | 12 | 14 | 6 |
| Exa `pub-launches` | 12 | 14 | 1 |
| Hacker News | 9 | 27 | 9 |
| Exa `openai` | 9 | 11 | 3 |
| Sonar `frontier` | 8 | 19 | 6 |
| Exa `ai-native` | 3 | 27 | 16 |
| Exa `pub-business` | 3 | 19 | 11 |
| Exa `big-tech` | 0 | 16 | 12 |
| Exa `policy` | 0 | 29 | 23 |
| Exa `tools` | 4 | 2 | 1 |
| Exa `research` | 2 | 0 | 0 |

`research` and `tools` add almost nothing. `policy`, `big-tech` and `ai-native` find many strong stories the owner
never published: either a gap in coverage, or not the owner's taste. That is the first question for tuning.

## Recommendation

**Build one search source, "Exa", in trial mode:** the Exa news and domain plans plus Hacker News, run before the
morning draft, each result graded with the extraction rubric (category, importance) and checked by the existing
repeat and duplicate checks. Use a direct Exa key in production: a Netlify function cannot call the Composio CLI.
16 calls a day stay inside Exa's $10 monthly free credit.

Alternatives:

1. Add Sonar as a second search source ($0.20 a month). It adds a little and returns some old news as new.
2. Add Grok `x_search` later, after a better handle list is tested. Today it adds almost nothing.

## Tuning list

To do with the owner, one at a time, rerunning the backtest after each change:

1. **Taste:** do policy, big-tech deals and AI-native launches belong in the issue? The answer decides whether
   `policy`, `big-tech` and `ai-native` stay.
2. **Drop** the `research` and `tools` Exa queries.
3. **Sites:** exclude low-quality aggregators seen in the runs (aiweekly.co, the-ai.news, ai123.com, ai.info,
   blockchain.news, tokenpost.com, gate.com, aimag.no, cortexplor.com), or list trusted publishers instead.
4. **Company-site noise:** exclude `support.`, `community.` and `podcasts.` subdomains, and customer stories
   (`openai.com/index/<customer>`), or let grading drop them (importance 1).
5. **Old news re-reported** (Gemini 4 Argon, gpt-oss with a new date): check against earlier issues with the repeat
   check, and drop results with no date.
6. **Non-English results:** drop them, or ask Exa for English only.
7. **Grading threshold** for the trial preview: show importance 3 and up, or 4 and up.
8. **Sonar prompt:** keep or drop; if kept, tell it to skip events older than the window.
9. **Grok handles,** if X is retried.

## Run it again

```sh
DATABASE_URL="$(neon connection-string dev --project-id damp-boat-84187674 --role-name neondb_owner --database-name neondb)" \
OPENROUTER_API_KEY=... LIVE_SEARCH_PROVIDERS=exa,sonar,hn \
npx vite-node --config evals/vitest.eval.config.ts evals/live-search/sample.ts -- 2026-10-20 2026-11-04
```

Exa runs through the Composio CLI, so the CLI must be signed in with an active Exa connection. Managed Exa takes at
most 10 results a call and no page content. Each run writes one JSON file per date (published stories with their
matches, every result with its grade and board match) to `evals/data/live-search/`.
