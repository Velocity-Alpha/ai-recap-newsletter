# Research: live AI-news discovery APIs and job runners

Checked on **2026-11-04**. Every fact links to a numbered source in [Sources](#sources), and all of those
were checked on that date. Items marked **Unconfirmed** come from secondary sources or could not be
checked against an official page. Prices are in USD and change often, so re-check them before you commit.

Context: AI Recap wants to publish around 06:00–08:00 ET on weekdays. That means stories can no longer
come only from other newsletters arriving by Gmail, which usually land around 10:00 ET. This doc covers
(A) the APIs that could find the last 24 hours of AI news by themselves and (B) where the native
TypeScript pipeline should run.

---

## Summary

**Live news discovery**

| Role | Pick | Backup / cross-check | Rough cost at 20–40 calls per weekday |
|---|---|---|---|
| Broad "what happened in AI in the last 24 h" | **Perplexity** (Search API for raw dated results, or Agent API `web_search` with `search_recency_filter: "day"`) | **Exa** (`category: "news"` + `startPublishedDate` as an ISO timestamp) | Perplexity $0.44–$4.40/mo for raw search, or about $1–$10/mo for agent calls. Exa is about $3–$15/mo before its $10 monthly free credit. |
| X / social pulse | **xAI Grok `x_search`** (date range + list of up to 20 allowed handles) | None comparable found | About $13–$25/mo for 5 calls per weekday (depends on posts returned) |
| Cheap cross-check | **Hacker News** (Algolia `search_by_date`) + **HF daily papers** + **Google News RSS `when:1d`** | arXiv API | $0 |

**Job runner:** use **Trigger.dev Hobby, $10/mo**. The estimated workload uses $1.50–$2.70 of compute,
which the plan's included $10 usage credit covers. The Free plan doesn't work here: it has no Staging, and
its schedules can't run more often than once an hour. Alternatives:
(1) **Netlify Scheduled + Background Functions**, about $0–$1.30/mo extra in credits, but you build retries,
idempotency, alerts and the UTC/DST handling yourself;
(2) **Inngest Free on Netlify**, $0, but each step is capped by Netlify's 60 s synchronous limit, so a
300 s LLM call has to be restructured.

**Corrections to the first draft of `docs/n8n-backend/70-migration-plan.md`** (now applied there):
- Netlify's synchronous limit is **60 s**. Only scheduled functions are limited to 30 s [82].
- Trigger.dev **Free has no Staging** [63] and **can't schedule more often than hourly** [62]. "The free plan
  is enough to start" holds only for hourly, Dev and Prod-only work.

---

## Part A — Live AI-news discovery APIs

### A.1 What changed in 2026 (read this first)

- **xAI Live Search is gone.** Sending the old `search_parameters` field to Chat Completions now returns
  `410 Gone` with "Live search is deprecated. Please switch to the Agent Tools API" (Vercel AI SDK PR, merged
  2026-05-30) [8]. The old docs URL `docs.x.ai/docs/guides/live-search` now serves the Web Search tool page
  [1]. The replacement is the server-side **`web_search`** and **`x_search`** tools on the Responses API [1][2][7].
- **Perplexity Sonar Chat Completions was retired on 2026-09-27** [14]. Synchronous and streaming Sonar
  calls are quietly rewritten as **Agent API** (`POST /v1/agent`) requests. Async Sonar requests "are no
  longer supported" [14]. The suggested mapping is Sonar → `fast`, Sonar Pro → `fast` (the how-to page says
  `low` [15]), Sonar Reasoning Pro → `low`, and Sonar Deep Research → `high` (or `xhigh`) [14]. The Agent API
  model list shows only `perplexity/sonar`. A forum user reports there is no `sonar-pro` ID [26]. In October
  2026, `preset` was renamed to `effort`, and the underlying models of the effort levels keep changing [13].
  **For reproducible results, pin an explicit `model` + `tools` instead of an effort level.**
- **Tavily** agreed to be acquired by **Nebius** on 2026-02-10 (about $275M). It says it will keep its own
  brand [42]. Whether the deal has closed is **Unconfirmed**.
- **Brave** dropped its free Search API plan. Each plan now includes a $5 monthly credit and needs a card
  [43] (no free plan **Unconfirmed**, secondary sources only).

### A.2 Freshness, citations and output shape

| Provider | How to limit to the last 12–24 h | Source URLs / publish dates in results | Structured output | X / Twitter coverage |
|---|---|---|---|---|
| **xAI Grok** `web_search` / `x_search` | `web_search`: **no date filter documented**. Only domain allow/deny lists (max 5) are available [1]. `x_search`: `from_date` / `to_date` as `YYYY-MM-DD` (UTC, `to_date` exclusive) [2]. Day-level only, so filter post timestamps in code. | URLs yes: a `citations` list, plus `url_citation` annotations on Responses [6]. **No publish date field** in citations [6]. | Yes. `json_schema` with `strict` works alongside server-side tools on Grok 4-family models [9]. Combining it with `x_search` is **Unconfirmed**. | **Native.** Searches posts, profiles and threads. Handle allow/deny lists up to 20. Optional image and video understanding [2]. |
| **Perplexity** Agent API `web_search` | `filters.search_recency_filter`: `hour` / `day` / `week` / `month` / `year`. Or `search_after_date_filter` / `search_before_date_filter` (`MM/DD/YYYY`) [18]. Recency and exact dates can't be combined [20]. | Each result has `url`, `title`, `date` (published), `last_updated`, `snippet` [18]. | Yes, `response_format` `json_schema` (the FAQ also mentions `text.format`, so check which your SDK version expects) [22]. | None documented (**Unconfirmed**) |
| **Perplexity** Search API (`POST /search`) | Same recency and date filters [20]. Up to 5 queries per request [19]. | `title`, `url`, `snippet`, `date`, `last_updated`. Returns raw ranked results with no generated answer [19]. | N/A (raw results) | None documented |
| **OpenAI** Responses `web_search` | **No date or recency filter documented** [27]. Freshness only through the prompt. | `url_citation` annotations (URL, title, offsets). The full source list is available via `include: ["web_search_call.action.sources"]` [27]. No publish date. | `text.format` `json_schema` exists in Responses [29]. Using it in the same call as `web_search` is **Unconfirmed**. | None documented |
| **Anthropic Claude** `web_search` | **No date filter.** You get `max_uses`, domain allow/block lists and `user_location` [30]. | Results have `url`, `title`, `page_age` ("when the site was last updated"). Citations have `url`, `title`, `cited_text` [30]. | Structured outputs **can't be combined with citations** [32]. Web search always cites [30], so the combination likely fails (**Unconfirmed**; prompt for a line format instead). | None documented |
| **Exa** `/search` | `startPublishedDate` / `endPublishedDate` as **ISO 8601 date-times** (hour-precise) [34]. `maxAgeHours` (0 = fetch fresh) replaces the deprecated `livecrawl` [34]. `category: "news"` [34]. | `url`, `title`, `publishedDate` (estimated from HTML and "may be a rough guess"), `author` [34]. | Yes. `outputSchema` (max 10 properties, 2 levels of nesting) or `summary` with a JSON schema [34]. | `tweet` is not in the current category list [34] |
| **Tavily** `/search` | `topic: "news"` + `time_range: "day"`, or `start_date` / `end_date` (`YYYY-MM-DD`) [38]. The old `days` parameter is no longer on the reference page [38]. | `url`, `title`, `content`, `score`, `published_date` (turned on automatically for `topic: news`, "best estimate") [38]. | Not documented. Optional `include_answer` [38]. | None documented |
| **Brave** News Search | `freshness=pd` (last 24 h), or a custom range such as `2022-04-01to2022-07-30` [44]. | Response fields are not shown on the docs page (**Unconfirmed**) [44]. | N/A (raw results) | None |

### A.3 Pricing, limits, SDKs, terms, reliability

| Provider | Price (official) | Rate limits | TypeScript SDK | Terms that matter for a newsletter | Known reliability issues |
|---|---|---|---|---|---|
| **xAI Grok** | Tokens: `grok-4.3` $1.25 in / $2.50 out per 1M. `grok-4.7` $2 / $6 (both under 200k prompt) [4]. Tools: `web_search` **$5 per 1k calls**. `x_search` **$5 per 1k posts and $10 per 1k profiles**, counted per item including parent and quoted posts, and not de-duplicated across searches [2][3]. | Tier 0: `grok-4.3` 37 RPS / 10M TPM. Tiers rise with total spend ($50 / $250 / $1k / $5k) and never go down [5]. | No official xAI TS SDK found. Use `@ai-sdk/xai` (`xai.tools.webSearch()` / `xSearch()`) [8] or the OpenAI SDK against xAI's Responses API [1]. | Enterprise terms: you own the output and may not use it to train models [10]. Brand guidelines ask for a "Written with Grok"-style credit [10][11] (the FAQ is old, **Unconfirmed** whether it still applies to API use). The rights to quote X post text come from X's terms and **were not reviewed**. | The Live Search shutdown broke callers with a 410 [8]. Citations carry no dates [6]. Third-party tools use 60 s timeouts for Grok searches (**Unconfirmed**). |
| **Perplexity** | Search API: **$5 per 1k requests**, or **$1 per 1k** with `search_type: "fast"`. A multi-query request (up to 5) counts as one [12][19]. Agent API: model tokens + `web_search` $2.50 per 1k ($1 per 1k fast), `fetch_url` $0.0005 per call [12]. `perplexity/sonar` $0.25 in / $2.50 out per 1M [16]. | Agent API: Tier 0 is 1 QPS, Tier 1 is 3 QPS. Search API: 50 query-units/s on every tier [21] (search summary). | `@perplexity-ai/perplexity_ai` [19] | Agent API: you own the output. **Search API: you do not own the output**, and Perplexity may reuse Search Data [23] (search summary). Take URLs from `search_results`, not from model-written text [23]. | Date filters sometimes don't hold. The docs' own example for a 3/1–3/5/2025 filter returns results from 2019–2025 [20]. LiteLLM silently dropped the recency filter [25], and domain filters have leaked [25]. Heavy API churn in 2026 [13][14]. |
| **OpenAI** | `web_search` **$10 per 1k calls**, plus search content tokens at model rates [28]. `gpt-6-luna` $0.10 / $0.50, `gpt-6.1-terra` $1 / $5 per 1M [28]. | Same as the model's tier [27]. | `openai` (already in `package.json`) | "You must show inline citations as prominent, clickable links" when you display web results [27]. | Search context is capped at 128k tokens [27]. No date filter, so it can return stale items. |
| **Anthropic** | `web_search` **$10 per 1k searches**, plus tokens. Results count as input tokens [30]. Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10 per 1M [31]. Dynamic filtering (`web_search_20260209`+) cuts tokens, and its code execution is free [30][31]. | Org-level web-search limit shown in the Console [30]. | Official TS SDK (examples in [30]) | "When displaying API outputs directly to end users, citations must be included." If you rewrite the output, cite "as appropriate" after legal review [30]. | Errors come back as HTTP 200 with `web_search_tool_result_error` (`too_many_requests`, `unavailable`) [30]. Long turns can stop with `pause_turn` [30]. |
| **Exa** | `/search` `auto`: **$7 per 1k** (up to 10 results). `lite`: $4 per 1k. `deep`: $12 per 1k. Content is $1 per 1k pages for each type (text, highlights, summary) [33]. **$10 free credit that "resets to $10 on the first of every month"** [33]. | 10 QPS on `/search`, 5 QPS for deep types. 25 QPS after $1k of spend in 30 days [35] (search summary). | `exa-js` [36] | An older ToS restricts displaying "information obtained through the Services" without permission [37] (**Unconfirmed** whether this is still current, so ask Exa). | `publishedDate` is an estimate [34]. Several 2026 parameter changes (`livecrawl` and crawl dates deprecated) [34]. |
| **Tavily** | Search basic = 1 credit, advanced = 2 [39]. **1,000 free credits per month**. Pay as you go $0.008 per credit. Project plan $30 for 4,000 credits [39]. | 100 RPM on dev keys, 1,000 RPM on production keys [40]. | `@tavily/core` [41] | Not reviewed (**Unconfirmed**) | Ownership changed (Nebius) [42]. `published_date` is a "best estimate" [38]. |
| **Brave** | Search plan **$5 per 1k requests**, $5 monthly credit, 50 QPS. Answers plan $4 per 1k + $5 per 1M tokens, 2 QPS [43]. | 50 QPS (Search plan) [43] | No official SDK found (**Unconfirmed**). Plain REST. | **No storing or caching of results "other than transient storage"** unless your plan includes storage rights. No use for training or evaluating models. No redistribution [45]. Attribution is optional [45]. | Card required even to use the free credit [43] (secondary). |

### A.4 Worked cost estimates (22 weekdays per month)

These numbers are assumptions, not quotes. Real token use depends on prompts and on how many results each
search returns.

**Raw search APIs** (you rank and summarize with your existing OpenAI pipeline; that LLM cost isn't included).
20–40 requests per weekday = **440–880 requests per month**:

| API | Monthly |
|---|---|
| Perplexity Search (standard / fast) | $2.20–$4.40 / $0.44–$0.88 [12] |
| Exa `auto` + highlights for 10 results | $7.48–$14.96 before the $10 monthly free credit [33] |
| Tavily basic (news) | $0 (inside 1,000 free credits). Advanced is up to about $6 at pay-as-you-go rates [39]. |
| Brave News | $2.20–$4.40, covered by the $5 monthly credit [43] |

**Agentic calls** (LLM decides what to search). Each call is assumed to make 3 searches, read 20k input
tokens and write 1.5k output tokens. 20–40 calls per weekday = **440–880 calls per month**:

| Stack | Per call | Monthly |
|---|---|---|
| Perplexity Agent API, `perplexity/sonar` + fast `web_search` | $0.0118 | $5.2–$10.3 [12][16] |
| Perplexity `effort: "low"` (docs example: about $0.0022 per request) | about $0.002 | about $1–$2 [24] (search summary) |
| OpenAI `gpt-6-luna` + `web_search` | $0.0328 | $14.4–$28.8 [28] |
| Anthropic Haiku 5.5 + `web_search` | $0.0328 | $14.4–$28.8 [30][31] |
| xAI `grok-4.3` + `web_search` | $0.0438 | $19.3–$38.5 [3][4] |
| Anthropic Sonnet 5.5 + `web_search` | $0.085 | $37–$75 [30][31] |

**X pulse** (xAI `x_search`). Assume 5 calls per weekday, each returning 20–40 posts (**Unconfirmed**; check
`server_side_tool_usage` on real calls), with 15k in / 1.5k out tokens on `grok-4.3`.
That is 2,200–4,400 posts × $5 per 1k = $11–$22, plus about $2.50 in tokens, so **about $13.50–$24.50 per
month** [2][3][4].

### A.5 Free and cheap signals

| Source | How to get the last 24 h | Limits / terms | Notes |
|---|---|---|---|
| **Hacker News (Firebase API)** | `/v0/topstories`, `/v0/newstories`. Each item has `time` (Unix) and `url` [46]. | "There is currently no rate limit." No key needed [46]. | Good "is this a big deal?" signal. |
| **HN Algolia search** | `search_by_date?query=…&numericFilters=created_at_i>X,points>N` [47] | 10,000 requests/hour per IP (**Unconfirmed**, third-party only) [47] | Use keyword filters (OpenAI, Anthropic, LLM, …). |
| **Google News RSS** | `https://news.google.com/rss/search?q=<query>+when:1d&hl=en-US&gl=US&ceid=US:en` [48] | **Undocumented by Google, so terms of use are unknown** [48] | Free and wide coverage. May break without notice. |
| **arXiv API** | Query by submitted date | 1 request every 3 s, one connection at a time. Metadata is CC0. Link to the abstract page and don't re-host PDFs [49]. | Very noisy. Better used through HF daily papers. |
| **HF daily papers** | `https://huggingface.co/api/daily_papers?date=YYYY-MM-DD` (**Unconfirmed**, seen in third-party code and the `huggingface_hub` CLI) [50] | HF-wide rate limits apply [50] | Already a source today. |
| **Reddit Data API** | — | Self-service access was closed in Nov 2025 under the "Responsible Builder Policy". Approval is required, and commercial use needs a separate agreement (**Unconfirmed**, third-party) [51]. | **Not recommended.** |
| **GitHub "trending"** | No official trending API found. Approximate it with the Search API (`sort=stars`) [52]. | 30 search requests/min authenticated, 10/min unauthenticated [52] | Optional, for "hot repo" items. |

### A.6 Recommendations (plain language)

1. **Broad discovery: Perplexity first, Exa as backup.**
   - Perplexity has the **cheapest per-call price** and a **hard "last 24 hours" filter**. Every result
     comes back with a **URL and a publish date**, and output can be forced into JSON [18][19][22]. Two ways
     to use it: (a) the **Search API** returns plain dated links, and the existing OpenAI step ranks and
     summarizes them. This is the most predictable and the easiest to test. (b) The **Agent API** lets a
     model run several searches and return a JSON list of candidate stories. Pin an explicit `model`, because
     Perplexity changed its API several times in 2026 [13][14].
   - Exa is the backup because it uses a **different index**, takes an **exact timestamp** as the cutoff
     (for example, "published after yesterday 05:00 ET"), and has a news category and structured output
     [34]. The free credit may cover most of the bill [33].
   - **Trade-off:** neither provider's publish dates are fully reliable [20][34]. Recheck dates in code and
     drop anything older than the window.
   - Why not OpenAI or Anthropic search as primary: neither has a date filter, and their per-search price
     is 2–10× higher [27][28][30]. OpenAI is a reasonable **emergency fallback**, because the key and SDK
     already exist in this app.
2. **X / social pulse: xAI Grok `x_search`.** It is the only option found that searches X directly. You can
   limit it to a hand-picked list of up to 20 AI lab and researcher accounts, and set a date range [2].
   - **Trade-off:** it charges **per post returned**, so broad queries get expensive. Cap results with
     `max_turns` and handle lists [2].
   - Its date filter works only by whole UTC day, so filter by post time in code.
   - Its citations have no dates [6].
   - Don't use Grok `web_search` for general discovery: it has no date filter [1].
3. **Cheap cross-check: Hacker News + HF daily papers + Google News RSS.** All three are free [46][48][50].
   A story that also shows up on HN or Google News is more likely to matter.
   - Google News RSS is unofficial and its terms are unknown, so use it only as a signal and link to the
     publisher's own URL [48].

**Licensing note for all providers:** link to the original publisher's article, not to the API's copy.
Store URLs and your own summaries rather than the provider's snippets. This matters most for Brave, which
bans storing results beyond transient use [45], and for the Perplexity Search API, where you don't own the
output [23].

---

## Part B — Job runner for the native pipeline

### B.1 Workload model (assumptions)

| Job | When | Runs per month | Seconds per run | Compute-seconds per month |
|---|---|---|---|---|
| Discovery + ingestion | 1 per weekday, ~05:00 ET | 22 | 300 (high case: 600) | 6,600 (13,200) |
| Draft | 1 per weekday | 22 | 120 | 2,640 |
| Publish-detection poll | every 3 min, 8 h window, weekdays (high case: every 2 min) | 3,520 (5,280) | 5 | 17,600 (26,400) |
| Watchdog | every 10 min, 24/7 (high case: every 5 min) | 4,320 (8,640) | 3 | 12,960 (25,920) |
| **Total** | | **7,884 (13,964)** | | **39,800 s ≈ 11.1 h (68,160 s ≈ 18.9 h)** |

Single LLM calls can take up to 300 s, so each step needs a host that allows that.

### B.2 Feature comparison

| | **Trigger.dev** | **Inngest (on Netlify)** | **Netlify Scheduled + Background only** | **Render** | **Fly.io** |
|---|---|---|---|---|---|
| Cron with IANA timezone | Yes, with DST handled [62] | Yes, `TZ=America/New_York …` [74] | **UTC only** [80] | Cron jobs are **UTC only** [91]. An always-on worker can run its own scheduler. | Scheduled Machines are fuzzy (hourly, daily, etc., with no set time). Use a scheduler inside the container (supercronic) [94]. |
| Long steps | No maximum duration. `maxDuration` counts CPU time, and waits don't count [64]. | Step timeout up to 2 h, **but capped by the host** [71]. Netlify sync is **60 s, not configurable** [82]. | Scheduled **30 s**, background **15 min** [81][82] | Cron runs up to 12 h [91]. Workers always on. | Always on |
| Retries | Configurable `maxAttempts` + backoff per task or project [67] | 4 retries by default, per step, max 20 [76] | Background: 2 automatic retries (1 min, then 2 min later) [81] | Not documented for cron [91] | Build it yourself |
| Idempotency | `idempotencyKey`, 30-day TTL [66] | Built in at step level (completed steps aren't re-run) [76] | Build it yourself (Postgres run ledger) | Build it yourself | Build it yourself |
| Failure alerts | Email, Slack or webhook on run failure (after retries) [65] | Not listed on the pricing page (**Unconfirmed**) | Build it yourself | Not documented (**Unconfirmed**) | Build it yourself |
| Environments | Free: Dev + Prod. **Staging only on Hobby and Pro** [63]. Preview branches: Hobby 5, Pro 20 [60][61]. Schedules can be limited to certain environments [62]. | Production, custom envs, branch envs, local dev server [73]. Plan availability **Unconfirmed**. To keep crons out of branch envs, render the cron only in production [75]. | Scheduled functions **fire only on published production deploys**. Previews and branches can only be run manually ("Run now") [80]. | Separate services per environment (you set them up) | Separate apps per environment |
| Schedule frequency limit | **Free: no more than once per hour** [62]. Hobby 100 schedules, Pro 1,000 [60]. | None found | None stated [80] | None stated | — |
| Concurrency | Free 20, Hobby 50, Pro 200+ (prod) [61] | Free 5 concurrent steps, Pro 100 [70][71] | Not documented | 1 active run per cron job [91] | — |
| Log retention | 1 / 7 / 30 days (Free / Hobby / Pro) [60] | 24 h free, 7 days Pro [70] | Netlify function logs | Render logs | Fly logs |
| Fits this repo | Tasks live in `/trigger` and deploy separately with `trigger.dev deploy` [63]. The Prisma extension lists Prisma 7 as **beta-tested**, and the repo uses `^7.6.0`, so **verify** [68]. | `/api/inngest` route inside the Next.js app on Netlify [77] | Next.js route handlers already run on Netlify. Custom functions next to the Next.js adapter are **Unconfirmed**. | New service | New app |

### B.3 Monthly cost estimate for this workload

| Option | Fixed | Usage (base → high case) | **Estimated total per month** |
|---|---|---|---|
| **Trigger.dev Hobby** | $10, includes $10 usage credit [60] | Small 1x at $0.0000338/s + $0.000025 per run [60]. Base: 39,800 s × $0.0000338 = $1.35, plus 7,884 runs × $0.000025 = $0.20, so **$1.55**. High case: **$2.65**. Dev runs are free [60]. | **$10** (usage stays inside the included credit) |
| Trigger.dev Free | $0, $5 credit [60] | Same usage | $0, but **not viable**: no Staging, and schedules can't run more often than hourly [62][63] |
| Trigger.dev Pro | $50 [60] | Same | $50 (only for 30-day logs and more alert destinations) |
| **Inngest Free + Netlify** | $0 [70] | Executions = runs × (steps + 1) [70] (search summary). Base about 26k, high case about 47k, against a **50k cap with no overage (functions pause)** [70]. Plus Netlify compute, about 110–190 credits (see the next row). | **$0–$1.30**. The high case is close to the cap. Pro is $99 [70]. |
| **Netlify only** | Existing plan: Free 300 credits, Personal $9 / 1,000, Pro $20 / 3,000 [84] | Compute is 10 credits per GB-hour at the 1 GB default [83][84]. 11.1–18.9 GB-h = **111–189 credits**. Web requests are about 2 credits per 10k [84]. | **About $0.74–$1.28 extra** at the Pro top-up rate ($10 per 1,500 credits) [84]. It may fit inside the current plan's credits, which are shared with site traffic. |
| **Render worker** | Hobby workspace $0 [90] | Always-on worker, 512 MB at $7/mo [90] | **$7** |
| Render cron jobs | $1 minimum per cron service [91] | $0.00016/min at 512 MB [90]. 4 services. | **About $4**, but UTC-only, with no documented retries or alerts |
| **Fly.io worker** | No free allowance. $1 trial credit [93]. | shared-cpu-1x 256 MB $2.19/mo, 512 MB $3.69/mo [93] | **About $3.69** (512 MB suggested for Node + Prisma; my judgement) |

Staging costs nothing extra on any option as long as **schedules run only in production** and staging is
used for manual test runs:
- Trigger.dev: use the `environments` setting on schedules [62].
- Inngest: render the cron only in production [75].
- Netlify: this is the default behaviour [80].

### B.4 Recommendation

**Pick: Trigger.dev Hobby ($10/mo).** It is the only option that covers every requirement out of the box:
- IANA-timezone cron that handles DST [62]
- no step timeout for 300 s LLM calls [64]
- retries [67], idempotency keys [66] and run-failure alerts by email, Slack or webhook [65]
- a real Staging environment [63], plus schedules that can be limited to Production [62]

The usage estimate ($1.50–$2.70) fits inside the included $10 credit [60]. Things to check before you
commit:
- Prisma 7 support in `prismaExtension` [68]
- whether alerts can be limited to Production only (**Unconfirmed**) [65]
- why the pricing page lists Hobby environments as "Dev, Preview, Prod" [60] while the deploy docs say
  Staging is on Hobby and Pro [63] (**conflict**)

**Alternative 1: Netlify Scheduled + Background Functions (about $0–$1.30/mo, no new vendor).**
- The scheduled function (30 s limit) only hands off to a background function (15 min) [80][81][82].
- Scheduled functions never fire on previews, so staging runs are manual by default [80].
- Costs: you build the run ledger and idempotency in Postgres, the failure alerts, and DST handling. Cron is
  UTC-only, so either schedule both possible UTC hours and check New York time in code, or run hourly and
  gate in code [80].
- Background functions retry only twice [81].

**Alternative 2: Inngest Free on Netlify ($0).**
- You get durable steps, IANA cron and per-step retries [74][76].
- Every step is an HTTP call to Netlify, which is capped at **60 s** [82]. A 300 s LLM call therefore has to
  be split: start it in the provider's background mode, then poll with `step.sleep`. Inngest suggests
  streaming as a way to get longer run time, but it's **Unconfirmed** whether that works on Netlify [77].
- The 50k execution cap on Free is close at the high polling rate [70].

Not recommended: **Render or Fly workers** ($3.69–$7). They cost about as much as Trigger.dev Hobby, and you
still build scheduling durability, retries, alerts and a dashboard yourself. **Render cron jobs** are
UTC-only [91]. **Fly Scheduled Machines** can't run at a set time [94].

---

## Unconfirmed items and biggest uncertainties

1. **How many posts one `x_search` call returns.** This drives the X pulse cost [2][3]. Measure it with
   `server_side_tool_usage` on a few real calls.
2. **Whether Perplexity's date filters actually hold.** The docs' own examples show results outside the
   window [20], and proxies have dropped the filter [25].
3. **Trigger.dev plan details.** The pricing and docs pages disagree about Staging on Hobby [60][63], and
   Prisma 7 support is labelled beta [68].
4. **Using structured output and web search in the same call** on OpenAI [29] and Anthropic [32]. Test this
   before you design around it.
5. **Terms:** current Exa ToS on displaying results [37], Tavily terms, X's terms on quoting posts surfaced
   by Grok, and Google News RSS terms [48].
6. **Reddit API access** after the Nov 2025 policy change [51].
7. HN Algolia rate limit [47] and the HF `daily_papers` endpoint [50] come only from third-party sources.

---

## Sources

All checked 2026-11-04.

1. xAI — Web Search tool: https://docs.x.ai/docs/guides/tools/search-tools (the old `/docs/guides/live-search` URL serves this page)
2. xAI — X Search tool: https://docs.x.ai/developers/tools/x-search
3. xAI — Pricing (tools): https://docs.x.ai/developers/pricing
4. xAI — Models and token pricing: https://docs.x.ai/docs/models
5. xAI — Rate limits: https://docs.x.ai/developers/rate-limits
6. xAI — Citations: https://docs.x.ai/developers/tools/citations
7. xAI — Tools overview: https://docs.x.ai/developers/tools/overview
8. Vercel AI SDK PR #15718 (xAI Live Search 410, merged 2026-05-30): https://github.com/vercel/ai/pull/15718
9. xAI — Structured outputs (via search results): https://docs.x.ai/docs/guides/structured-outputs
10. xAI — Enterprise terms and FAQ (via search results): https://x.ai/legal/terms-of-service-enterprise, https://x.ai/legal/faq-enterprise
11. xAI — Brand guidelines: https://x.ai/legal/brand-guidelines
12. Perplexity — Pricing: https://docs.perplexity.ai/docs/getting-started/pricing and https://docs.perplexity.ai/getting-started/pricing
13. Perplexity — Changelog: https://docs.perplexity.ai/changelog
14. Perplexity — Migrate from Sonar (overview): https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview
15. Perplexity — How to migrate from Sonar (via search results): https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to
16. Perplexity — Agent API models: https://docs.perplexity.ai/docs/agent-api/models.md
17. Perplexity — Effort levels / presets: https://docs.perplexity.ai/docs/agent-api/presets
18. Perplexity — Agent API web_search tool: https://docs.perplexity.ai/docs/agent-api/tools
19. Perplexity — Search API quickstart: https://docs.perplexity.ai/docs/search/quickstart
20. Perplexity — Date/time filters: https://docs.perplexity.ai/guides/search-date-time-filters and https://docs.perplexity.ai/docs/search/filters/date-time-filters
21. Perplexity — Rate limits and usage tiers (via search results): https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers
22. Perplexity — Structured output (via search results): https://docs.perplexity.ai/docs/agent-api/building-agents/shape-output, https://docs.perplexity.ai/docs/resources/faq
23. Perplexity — API terms and Search addendum (via search results): https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service, https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service-search
24. Perplexity — Story timeline cookbook (per-request cost examples, via search results): https://docs.perplexity.ai/docs/cookbook/examples/agent-api-story-timeline/README
25. Filter reliability reports: https://github.com/BerriAI/litellm/issues/45536, https://community.perplexity.ai/t/search-domain-filter-not-working-getting-citations-outside-my-domain-list/77
26. Perplexity forum — sonar-pro on Agent API: https://community.perplexity.ai/t/keep-support-for-sonar-pro-on-the-agents-api/6172
27. OpenAI — Web search guide: https://developers.openai.com/api/docs/guides/tools-web-search
28. OpenAI — Pricing: https://developers.openai.com/api/docs/pricing
29. OpenAI — Structured outputs (via search results): https://developers.openai.com/api/docs/guides/structured-outputs
30. Anthropic — Web search tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
31. Anthropic — Pricing: https://platform.claude.com/docs/en/about-claude/pricing
32. Anthropic — Citations (via search results): https://platform.claude.com/docs/en/build-with-claude/citations
33. Exa — Pricing: https://exa.ai/pricing
34. Exa — Search reference: https://docs.exa.ai/reference/search
35. Exa — Rate limits (via search results): https://docs.exa.ai/reference/rate-limits
36. Exa — TypeScript SDK: https://docs.exa.ai/sdks/typescript-sdk-specification
37. Exa — Terms of Service PDF (older; via search results): https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf
38. Tavily — Search endpoint: https://docs.tavily.com/documentation/api-reference/endpoint/search
39. Tavily — API credits and plans: https://docs.tavily.com/documentation/api-credits
40. Tavily — Rate limits: https://docs.tavily.com/documentation/rate-limits
41. Tavily — JavaScript SDK: https://docs.tavily.com/sdk/javascript/quick-start
42. Nebius — Tavily acquisition announcement: https://nebius.com/newsroom/nebius-announces-agreement-to-acquire-tavily-to-add-agentic-search-to-its-ai-cloud-platform
43. Brave — Search API page: https://brave.com/search/api/ (free-plan removal and card requirement from secondary sources, e.g. https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/)
44. Brave — News search query docs: https://api-dashboard.search.brave.com/app/documentation/news-search/query
45. Brave — API Terms of Service: https://api-dashboard.search.brave.com/terms-of-service
46. Hacker News API: https://github.com/HackerNews/API
47. HN Algolia API: https://hn.algolia.com/api (page didn't render). Filters and limit from https://dev.to/agenthustler/scraping-hacker-news-in-2026-complete-guide-algolia-api-date-filters-3iep
48. Google News RSS parameters (third-party): https://newscatcherapi.com/blog/google-news-rss-search-parameters-the-missing-documentaiton
49. arXiv API Terms of Use: https://info.arxiv.org/help/api/tou.html
50. Hugging Face Hub API: https://huggingface.co/docs/hub/api. `daily_papers` usage seen in https://huggingface.co/spaces/evalstate/hf-papers/blob/main/hf_papers_tool.py
51. Reddit Responsible Builder Policy (third-party): https://www.keyapi.ai/blog/reddit-data-api-overhaul-major-changes-and-migration-guide/
52. GitHub REST — Search: https://docs.github.com/en/rest/search/search
60. Trigger.dev — Pricing: https://trigger.dev/pricing
61. Trigger.dev — Limits: https://trigger.dev/docs/limits
62. Trigger.dev — Scheduled tasks: https://trigger.dev/docs/tasks/scheduled
63. Trigger.dev — Deployment overview: https://trigger.dev/docs/deployment/overview
64. Trigger.dev — Max duration: https://trigger.dev/docs/runs/max-duration
65. Trigger.dev — Alerts: https://trigger.dev/docs/troubleshooting-alerts
66. Trigger.dev — Idempotency: https://trigger.dev/docs/idempotency
67. Trigger.dev — Errors and retrying: https://trigger.dev/docs/errors-retrying
68. Trigger.dev — Prisma extension: https://trigger.dev/docs/config/extensions/prismaExtension
70. Inngest — Pricing: https://www.inngest.com/pricing (execution definition via search results)
71. Inngest — Usage limits: https://www.inngest.com/docs/usage-limits/inngest
72. Inngest — Provider limits: https://www.inngest.com/docs/usage-limits/providers
73. Inngest — Environments: https://www.inngest.com/docs/platform/environments
74. Inngest — Scheduled functions: https://www.inngest.com/docs/guides/scheduled-functions
75. Inngest — FAQ (crons only in production, via search results): https://www.inngest.com/docs/faq
76. Inngest — Retries: https://www.inngest.com/docs/features/inngest-functions/error-retries/retries
77. Inngest — Serving functions (via search results): https://www.inngest.com/docs/learn/serving-inngest-functions
80. Netlify — Scheduled functions: https://docs.netlify.com/build/functions/scheduled-functions/
81. Netlify — Background functions: https://docs.netlify.com/build/functions/background-functions/
82. Netlify — Function configuration (60 s sync, 30 s scheduled, 15 min background): https://docs.netlify.com/build/functions/configuration/
83. Netlify — Functions usage and billing: https://docs.netlify.com/build/functions/usage-and-billing/
84. Netlify — Pricing: https://www.netlify.com/pricing/
90. Render — Pricing (markdown): https://render.com/pricing.md
91. Render — Cron jobs: https://render.com/docs/cronjobs
92. Render — Background workers: https://render.com/docs/background-workers
93. Fly.io — Pricing: https://docs.fly.io/about/pricing
94. Fly.io — Task scheduling guide and `fly machine run` (via search results): https://fly.io/docs/blueprints/task-scheduling/, https://fly.io/docs/machines/flyctl/fly-machine-run/
