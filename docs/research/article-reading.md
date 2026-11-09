# Research: how drafting should read a story's article

Checked on **2026-11-09** for issue #115. All measurements ran that day from one Mac on a home connection.
Every outside fact links to a numbered source in [Sources](#sources). Items marked **Unconfirmed** come from
secondary sources or could not be found on an official page. Free tiers change often, so re-check them before
you commit.

Terms follow [GLOSSARY.md](../../GLOSSARY.md). An **article** is the web page a story links to. A **source** is
the newsletter a story came from. The repo is public, so this doc holds only counts, host names and short notes.
It has no article text and no screenshots.

---

## Summary

**Recommended order for the feature sections (Top Stories, Research & Analysis):**

```
story link
   │
   ▼
1. site adapter (20 s)       arXiv / Hugging Face paper → arXiv HTML full text
   │ no adapter or fails      GitHub repo → README API; Hugging Face model → README file
   ▼
2. fetch + Readability (12 s)
   │ fails the text check
   ▼
3. Jina Reader, no key (30 s)
   │ fails the text check
   ▼
4. no article: write from the summary and mark the story
```

Run all ~8 reads at once. Give the whole read step a **60 s deadline**. Any read still running then falls back
to the summary.

**Results on 83 feature-section links from the last 3 weeks:**
- This order read **81 of 83 (98%)**. It read 81 of the 82 pages that a real browser can read (99%).
- Median time per link was **1.0 s**, p95 **13 s**, and the slowest took **25 s**.
- **Expected unreadable share: about 2% of feature stories** (2 of 83). Across all 120 links it is about 5%
  (6 of 120). Most of those are Product Hunt links in Tools and Quick Hits.
- One read method alone does worse: fetch read 88% of feature links, Jina 89% and a headless browser 93%.
- **No new key or paid service is needed.** A free Jina key is optional. See [Services and keys](#services-and-keys).

**Other findings:**
- **Don't run a browser on Netlify.** A browser in step 3 instead of Jina read the same 81 of 83. A browser
  adds a ~70 MB Chromium package and needs ~1.6 GB of memory [5].
- **OpenAI web search does open the link.** It opened all 51 links I gave it. Its facts matched the article on
  46 of 48 readable pages. But it returns facts, not the article text, so there is no copy to save. It costs
  about $0.012 per read. It rescued no feature story that the order above missed. Keep it out of the chain for
  now.
- **Site adapters give more than the page.** For papers they return the full paper: a median of 87,000
  characters, against 2,200 on the abstract page. They covered 36 of the 83 feature links.
- **Reading is worth it.** For feature stories, the stored summary plus details has a median of 930 characters.
  The article has 2,618, about 4× more. Of the OpenAI facts that matched a page, a median of 89% were not in the
  stored summary.
- **Tools and Quick Hits: keep using summaries.** The same order read every readable non-feature page (33 of 33),
  so reading them is cheap if you want it later. But they get one or two lines, and Product Hunt (the Tools
  source) showed a bot check on all 4 of its links.

---

## Sample

- I read the production database (read-only). There were 172 stories queued for or used in an issue in the last
  21 days.
- That gave **120 unique links**:
  - **all 83 feature-section links**: Top Stories 37 and Research & Analysis 46;
  - **37 other links**: Quick Hits 18, Tools 13, and 6 not placed in a section. These were picked round-robin by
    source.
- There are **55 hosts**. The biggest are huggingface.co (29), arxiv.org (8), github.com (8) and openai.com (8).

| Source | Links | Feature links |
|---|---|---|
| ai_breakfast | 20 | 14 |
| alphasignal | 27 | 21 |
| huggingface | 29 | 24 |
| product_hunt_ai | 4 | 0 |
| rundown_ai | 12 | 6 |
| tldr | 21 | 15 |
| tldr_ai | 7 | 3 |

---

## Ground truth: what a real browser shows

**How:**
- I used headless Chrome 156 through Playwright, with a normal desktop Chrome user agent and a 1280 px window.
- For each link I saved the final URL, the HTTP status, a full-page screenshot, the visible text (`innerText`)
  and Readability's main text [39] on the rendered page. Screenshots and text stayed on my machine.
- gpt-6-luna looked at each screenshot plus the visible text and said what a person sees [14][15].
- **I checked 20 screenshots by hand, and all 20 agreed with the model.**

**The reference text** for scoring is Readability on a second load that does not scroll. Scrolling pulled the
next story into TechCrunch and Yahoo pages (infinite scroll), so the first, scrolled load was wrong for them. I
made 4 hand fixes:
- an openai.com post shows an error in Chrome after it loads, but its server HTML holds the full article;
- on one blog, Readability picked an embedded code widget, so I used the visible text;
- an openai.com product page only loads its sections as you scroll, so I used the scrolled load;
- a GitHub repo page returned 504 on all three browser loads, so I used the README API.

| What a person sees | All | Feature | Other |
|---|---|---|---|
| article | 58 | 39 | 19 |
| paper page | 35 | 32 | 3 |
| repo README | 8 | 2 | 6 |
| block page (bot check) | 5 | 1 | 4 |
| social post | 4 | 1 | 3 |
| model card | 2 | 2 | 0 |
| PDF | 2 | 1 | 1 |
| docs or help page | 2 | 2 | 0 |
| product page | 2 | 1 | 1 |
| other (dashboard, filing) | 2 | 2 | 0 |

- **Readable by a real browser: 115 of 120 (96%); feature 82 of 83 (99%).**
- The 5 unreadable pages are all bot checks: Product Hunt 4 of 4 (Cloudflare) and money.usnews.com 1.
- **No page showed a paywall.** The database flags 2 sample stories as paywalled (fortune.com and
  finance.yahoo.com). A fresh browser showed both articles in full.
- Overlays: 31 cookie banners, 5 login prompts (mostly X) and 5 bot checks. No cookie banner or login prompt
  hid the main text.
- Status: 200 for 114 links, 403 for 4 and 504 for 2.
- A full browser load with screenshots took a median of 9.8 s (p95 35 s).

---

## Success rule

A method **reads** a page when all of these hold:
1. The ground-truth page is readable. That means it is not a paywall, cookie wall, login wall, block page or
   error page, its main content is visible, and the reference has at least 200 characters.
2. The method's text has at least min(500, half the reference) characters.
3. **Recall is at least 0.7.** Recall is the share of the reference's words that also appear in the method's
   text. Words are lowercase letters and digits, at least 2 characters long, and repeats are counted.
4. The text is not a block page.
5. It finished within the method's timeout (adapter 20 s, fetch 12 s, Jina 30 s, browser 25 s).

**Why 0.7 is safe:** for fetch, Jina and the browser, the recall scores split cleanly into two groups. Almost
every good read scored 0.95 or more, and the failures scored below 0.5. Moving the line anywhere between 0.5 and
0.9 changes at most 5 results per method. Paper adapters score about 0.84 against the paper page. They return
the full paper, and the page also has comments and links that the paper doesn't.

**Text quality** uses precision: the share of the method's words that are in the reference. Low precision means
extra menus, link lists or related posts. Fetch and the browser use the same Readability code as the reference,
so they score high on precision almost by design.

**At run time** there is no ground truth. So the chains below use a simple check and accept the first text that
passes it:
- status below 400;
- at least 500 characters of plain text;
- no block-page phrase, checked only on texts under 2,500 characters ("just a moment", "verify you are human",
  "captcha" and similar);
- no paywall phrase ("subscribe to continue" and similar).

Then I scored each chain's choice with the success rule above.

---

## Methods

| Method | All links (120) | Browser-readable (115) | Feature (83) | Median time | p95 time | Text quality: precision median / p25 | Cost per read | Netlify fit |
|---|---|---|---|---|---|---|---|---|
| (a) fetch + Readability | 102 (85%) | 102 (89%) | 73 (88%) | 0.3 s | 11.2 s | 1.00 / 1.00 | $0 | Good: plain Node plus jsdom (~8 MB) |
| (b) Jina Reader, no key | 102 (85%) | 102 (89%) | 74 (89%) | 2.6 s | 15.5 s | 0.98 / 0.44 | $0 (20 requests/min) | Good: one HTTP call |
| (c) OpenAI web search | 46 of 48 readable (subset) | – | – | 7.6 s | 18.0 s | facts only, no text | ~$0.012 | Good: one HTTP call |
| (d) headless browser | 108 (90%) | 108 (94%) | 77 (93%) | 3.5 s | 11.8 s | 1.00 / 1.00 | $0 locally | Poor: ~70 MB Chromium, ~1.6 GB memory |
| (e) site adapters | 44 of 48 tried | 44 of 48 | 35 of 36 tried | 2.9 s | 9.3 s | full paper or README | $0 | Good: plain HTTP |

Notes on the table:
- Recall on successful reads had a median of 99–100% for (a), (b) and (d).
- (d) is a lean reader: one Chrome process, a fresh context per link, and images, media and fonts blocked. It
  waits for the page to load, plus up to 3 s for the network to go quiet. A local Chrome started in 0.4 s.
- (c) ran on a subset of 51 links. See [OpenAI web search](#openai-web-search).

### Where each method failed (pages a browser could read)

**(a) fetch + Readability missed 13:**
- **GitHub returned 504 after ~11 s** on 4 repo pages. GitHub was flaky that day for every method except its API.
- **4 pages were slower than 12 s:**
  - sec.gov sent 14 MB of HTML, which took 14 s to parse;
  - liquid.ai sent 8.6 MB of HTML;
  - deepmind.google and anthropic.com each took ~15 s once.
- **3 pages build their text in the browser:** modelscope.cn, baseten.co, and a `twitter.com/i/web/status` link.
- **canva.com returned 403** to fetch only.
- **datacentersontheballot.com** sends a shell page and loads its data in the browser. Fetch got 4,190
  characters of shell, and the runtime check accepted it. **This is the only wrong text the recommended order
  accepted.**
- Two setup details mattered:
  - finance.yahoo.com sends very large response headers, so Node's default header limit fails the request;
  - one retry fixed every network error I saw.

**(b) Jina Reader missed 13:**
- GitHub 504 on 5 repo pages. Jina passed the error page through.
- "Anonymous access to domain blocked" on fortune.com and crowdstrike.com. A free key probably lifts this
  (**Unconfirmed**).
- justice.gov answered Jina with 401, but answered fetch.
- It returned nothing for a 32 MB PDF, 50 characters for tencent.com, and one 503 on Hugging Face.
- One Hugging Face paper page came back garbled, and the runtime check accepted it.
- It got the same datacentersontheballot.com shell as fetch.
- Asking for its browser engine (`X-Engine: browser` [11]) fixed none of 5 retries. It seemed to answer from
  its cache.
- **Quality:** Jina keeps more extras. 37 of its 102 good reads had precision below 0.8 (fetch: 2 of 102). These
  extras are menus, link lists and related posts. An LLM can ignore them, but they cost tokens.
- **Size:** a median of 2,453 tokens per page; p95 20,747.

**(d) headless browser missed 7:**
- GitHub 504 on 4 repo pages.
- fortune.com showed a loading screen (1,640 characters), and the runtime check accepted it.
- On one blog, Readability picked a code widget, and the runtime check accepted it.
- An openai.com product page loads its sections only on scroll, so the reader got 188 characters.

---

## Site adapters

Some hosts have a free API or a cleaner page than the one the story links to.

| Adapter | How | Links | Read | Median characters | Median time |
|---|---|---|---|---|---|
| Hugging Face paper | HF papers API gives the arXiv id [21] → `arxiv.org/html/<id>` | 26 | 26 | 80,116 | 3.1 s |
| Hugging Face paper, no arXiv HTML | HF papers API → arXiv API abstract [17] | 1 | 1 | 3,677 | 5.5 s |
| arXiv paper | `arxiv.org/html/<id>` | 8 | 8 | 97,577 | 2.6 s |
| GitHub repo | REST "get a repository README", raw format [22] | 8 | 8 | 3,552 | 0.2 s |
| Hugging Face model | `README.md` through `/resolve/main/` | 1 | 1 | 6,928 | 0.0 s |
| X post | `publish.x.com/oembed` [24] | 4 | 0 | 261 | 0.1 s |

- **The paper adapters return the whole paper.** That gives the writer methods and results, not just the
  abstract.
- **The X adapter is not worth it.** It returns only the short post text, which is less than the page shows.
  Jina read all 4 X pages and fetch read 3, so I dropped it from the chains.
- **Adapters covered 36 of 83 feature links (43%)** and 48 of 120 overall.
- The two slowest adapter reads were big arXiv HTML papers, at 10.7 s and 15.8 s. Hence the 20 s timeout.
- **Rate limits:**
  - arXiv asks for at most one API request every 3 seconds [16]. arXiv HTML exists for TeX papers submitted
    since December 2023, and a small share have none [18][19].
  - Hugging Face allows 500 anonymous API calls per 5 minutes per IP [20].
  - GitHub allows 60 unauthenticated requests per hour per IP [23].

---

## OpenAI web search

**Setup:**
- gpt-6-luna on the Responses API with the `web_search` tool [12]. I passed
  `include: ["web_search_call.action.sources"]` to see what it opened.
- The prompt gave the link and asked for 10 facts from that page, as structured output.
- A second gpt-6-luna call judged each fact against the reference text and against the stored summary.
- **Subset:** 51 links. That is 41 spread across hosts plus 10 hard cases where some method failed (for example
  Product Hunt, GitHub, canva.com, baseten.co, Yahoo, and the openai.com page that errors in Chrome).

| Group | Links | Opened the link | Said it read it | Saw the article | Facts supported (median) | Contradicted facts | Median time | p95 time |
|---|---|---|---|---|---|---|---|---|
| All | 51 | 51 (100%) | 45 (88%) | 47 (92%) | 100% | 1 | 7.6 s | 18.0 s |
| Browser-readable | 48 | 48 (100%) | 43 (90%) | 46 (96%) | 100% | 1 | 7.6 s | 18.0 s |
| Not browser-readable | 3 | 3 | 2 | 1 | – | 0 | 5.2 s | 15.8 s |

**What "saw the article" means:** it opened the link, at least 70% of its facts are in the reference, and at
least 3 of those facts are not in the stored summary.
- The two readable misses were an arXiv page (6 of 10 facts) and a Hugging Face paper page (only 2 new facts).
- It read one Product Hunt page that blocked every other method. I checked its facts by hand against a load
  where the bot check had passed.
- It failed on money.usnews.com.

**Findings:**
- **It opens the given link.** Every run used the `open_page` action on the link. The docs don't promise this
  (**Unconfirmed** as a contract) [12].
- **Its own access report is unreliable.** 5 times it said it could not open the page, yet its facts matched the
  page.
- **Cost:** median 10,358 input tokens and 718 output tokens. It made a median of 1 tool call (max 5). At $10 per
  1,000 tool calls plus $0.10 / $0.50 per million input / output tokens, that is about **$0.012 per read** [13][14].
- **Limits for this use:**
  - it returns facts, not text, so the reader can't save a copy for #120;
  - nothing can check it at run time;
  - it may mix in other web sources;
  - the page content goes straight into the model's context.
- **Value in the chain:** on this sample it adds nothing for feature stories. The order above missed only
  usnews, where OpenAI failed too, and the datacenters shell, which an earlier step had already accepted. It
  might help with blocked Tools links later.

---

## Chains

I simulated each chain from the per-method results. The first text that passes the runtime check wins. A step
that timed out counts its full timeout and then falls through.

| Chain | Feature read (83) | Feature wrong text | Feature nothing | Median | p95 | Max | All read (120) |
|---|---|---|---|---|---|---|---|
| fetch | 73 (88%) | 1 | 9 | 0.3 s | 11.4 s | 12.0 s | 102 (85%) |
| Jina | 74 (89%) | 2 | 7 | 2.5 s | 14.7 s | 24.9 s | 102 (85%) |
| browser | 77 (93%) | 2 | 4 | 3.5 s | 8.3 s | 16.1 s | 108 (90%) |
| adapter → fetch | 75 (90%) | 1 | 7 | 0.9 s | 12.0 s | 15.8 s | 106 (88%) |
| adapter → Jina | 77 (93%) | 1 | 5 | 2.9 s | 13.2 s | 16.0 s | 109 (91%) |
| **adapter → fetch → Jina** | **81 (98%)** | 1 | 1 | 1.0 s | 13.2 s | 25.2 s | **114 (95%)** |
| adapter → fetch → browser | 81 (98%) | 1 | 1 | 1.0 s | 13.5 s | 16.8 s | 114 (95%) |
| adapter → fetch → Jina → browser | 81 (98%) | 1 | 1 | 1.0 s | 13.2 s | 25.2 s | 114 (95%) |

- **Which step read the feature links:** adapter 35, fetch 41, Jina 6, none 1 (plus 1 wrong text).
- **Adding a browser after Jina gains nothing.** Using a browser instead of Jina gives the same count and a lower
  maximum time (17 s against 25 s). It is not worth the bundle and memory cost on Netlify.
- **Not read by adapter → fetch → Jina (6 of 120):**
  - money.usnews.com (feature): every method got a bot block;
  - datacentersontheballot.com (feature): the shell page was accepted (only a browser gets the data);
  - producthunt.com, 4 links (not feature): Cloudflare check for every method.

---

## Per source

Feature and non-feature links together. "Order" is adapter → fetch → Jina.

| Source | Links | Browser-readable | fetch | Jina | browser | adapter (where used) | Order |
|---|---|---|---|---|---|---|---|
| ai_breakfast | 20 | 19 (95%) | 16 (80%) | 18 (90%) | 17 (85%) | 2 of 2 | 19 (95%) |
| alphasignal | 27 | 27 (100%) | 22 (81%) | 24 (89%) | 25 (93%) | 12 of 14 | 27 (100%) |
| huggingface | 29 | 29 (100%) | 28 (97%) | 25 (86%) | 28 (97%) | 29 of 29 | 29 (100%) |
| product_hunt_ai | 4 | 0 (0%) | 0 | 0 | 0 | – | 0 (0%) |
| rundown_ai | 12 | 12 (100%) | 10 (83%) | 10 (83%) | 11 (92%) | 0 of 1 | 11 (92%) |
| tldr | 21 | 21 (100%) | 19 (90%) | 19 (90%) | 20 (95%) | 1 of 1 | 21 (100%) |
| tldr_ai | 7 | 7 (100%) | 7 (100%) | 6 (86%) | 7 (100%) | 0 of 1 | 7 (100%) |

The adapter misses in alphasignal, rundown_ai and tldr_ai are X posts. The chains don't use the X adapter.

---

## Per host

**Hosts with 2 or more links:**

| Host | Links (feature) | Browser sees | fetch | Jina | browser | adapter | OpenAI | Order | Note |
|---|---|---|---|---|---|---|---|---|---|
| huggingface.co | 29 (26) | paper, article, model card | 29/29 | 27/29 | 29/29 | 28/28 | 0/1 | 29/29 | Jina: one 503 and one garbled page |
| arxiv.org | 8 (8) | paper | 8/8 | 8/8 | 8/8 | 8/8 | 0/1 | 8/8 | adapter gives the full paper |
| github.com | 8 (2) | README | 4/8 | 3/8 | 4/8 | 8/8 | 3/3 | 8/8 | 504 after ~11 s; the API always worked |
| openai.com | 8 (6) | article, product page | 8/8 | 8/8 | 7/8 | – | 2/2 | 8/8 | one product page loads on scroll |
| producthunt.com | 4 (0) | bot check | 0/4 | 0/4 | 0/4 | – | 1 of 2 (hand check) | 0/4 | Cloudflare check |
| techcrunch.com | 4 (3) | article | 4/4 | 4/4 | 4/4 | – | 1/1 | 4/4 | infinite scroll |
| anthropic.com | 3 (1) | article | 2/3 | 3/3 | 3/3 | – | 1/1 | 3/3 | one fetch over 12 s |
| claude.com | 3 (1) | article, product page | 3/3 | 3/3 | 3/3 | – | 1/1 | 3/3 | |
| finance.yahoo.com | 3 (2) | article | 3/3 | 3/3 | 3/3 | – | 2/2 | 3/3 | large headers; infinite scroll |
| blog.google | 2 (2) | article | 2/2 | 2/2 | 2/2 | – | 1/1 | 2/2 | |
| elevenlabs.io | 2 (0) | article | 2/2 | 2/2 | 2/2 | – | – | 2/2 | |
| twitter.com | 2 (1) | social post | 1/2 | 2/2 | 2/2 | 0/2 | 1/1 | 2/2 | `i/web/status` link gave fetch a stub |
| x.com | 2 (0) | social post | 2/2 | 2/2 | 2/2 | 0/2 | – | 2/2 | |

**Hosts with 1 link where some method failed:**

| Host | Feature | fetch | Jina | browser | Order | Note |
|---|---|---|---|---|---|---|
| baseten.co | no | ✗ | ✓ | ✓ | ✓ | text built in the browser |
| canva.com | no | ✗ | ✓ | ✓ | ✓ | 403 to fetch only |
| crowdstrike.com | no | ✓ | ✗ | ✓ | ✓ | Jina: anonymous access blocked |
| datacentersontheballot.com | yes | ✗ | ✗ | ✓ | ✗ | shell page accepted |
| deepmind.google | yes | ✗ | ✓ | ✓ | ✓ | fetch over 12 s once |
| fortune.com | yes | ✓ | ✗ | ✗ | ✓ | Jina blocked; browser saw a loading screen |
| justice.gov | yes | ✓ | ✗ | ✓ | ✓ | 401 to Jina |
| liquid.ai | yes | ✗ | ✓ | ✓ | ✓ | 8.6 MB of HTML |
| modelscope.cn | yes | ✗ | ✓ | ✓ | ✓ | text built in the browser |
| money.usnews.com | yes | ✗ | ✗ | ✗ | ✗ | bot block for everyone |
| rikiyat.github.io | yes | ✓ | ✓ | ✗ | ✓ | browser's Readability picked a widget |
| sec.gov | yes | ✗ | ✓ | ✓ | ✓ | 14 MB filing, slow to parse |
| tencent.com | yes | ✓ | ✗ | ✓ | ✓ | Jina returned 50 characters |
| www-cdn.anthropic.com | yes | ✓ | ✗ | ✓ | ✓ | 32 MB PDF; Jina returned nothing |

**Hosts with 1 link that every method tried read (28):**
- alignment.anthropic.com, artificialanalysis.ai, axiommath.ai, cloud.google.com, cursor.com;
- developer.apple.com, docs.litellm.ai, engineering.fb.com, epoch.ai, felixrieseberg.com;
- fireworks.ai, geopolitechs.org, help.openai.com, kimi.ai, linum.ai;
- mediaoffice.abudhabi, metr.org, microsoft.ai, minimax.io, mistral.ai;
- nebius.com, ppc.land, public-inspection.federalregister.gov (PDF), raindrop.ai, research.meta.ai;
- safeguards.anthropic.com, testingcatalog.com, thenextweb.com.

---

## Netlify fit and time budget

**Limits:** a background function runs for up to 15 minutes [1]. Memory is 1024 MB by default, and you can set
1024–4096 MB [2]. The unzipped bundle can be up to 250 MB [3]. A 50 MB zipped limit appears only in a forum reply
(**Unconfirmed**) [4].

**The recommended order fits as-is:**
- **Adapters and Jina** are plain HTTP calls.
- **fetch + Readability** needs a DOM library:
  - jsdom (about 8 MB installed) plus `@mozilla/readability`;
  - lighter DOMs such as linkedom, or the repo's `node-html-parser`, were not tested with Readability here;
  - `unpdf` (about 2.5 MB installed) read both PDFs, including the 32 MB one.
- **Time:** run the ~8 reads at once.
  - Per-link timeouts: adapter 20 s, fetch 12 s and Jina 30 s. The worst case is 62 s, and the slowest link
    measured took 25 s.
  - A 60 s deadline for the whole read step uses under 7% of the 15-minute budget.
- **Jina load:** Jina handled 6 of 83 feature links. That is under one Jina call per issue, far below the
  keyless 20 requests per minute [10].

**A browser on Netlify is possible but not worth it:**
- `@sparticuz/chromium` v153 is about 70 MB. It needs at least 512 MB of memory and recommends 1600 MB [5][6].
- It must be kept out of the bundler with `external_node_modules` [2][8].
- The `-min` variant downloads a ~70 MB pack to `/tmp` on each cold start [5].
- One Netlify report hit a missing `libnss3` library [7].
- It doesn't run on macOS, so local tests would need Linux [9].
- If a browser is ever needed, use a hosted one. See [Services and keys](#services-and-keys).

---

## Services and keys

**Nothing new is required.** The recommended order uses free, keyless endpoints.

| Service | Needed? | Free tier | Paid | Note |
|---|---|---|---|---|
| Jina Reader | Used with no key | 20 requests/min with no key. A free key gives 500 requests/min and 10M tokens [10]. | Billed per output token; price **Unconfirmed** [10] | A key probably lifts the "anonymous access blocked" errors (**Unconfirmed**). At ~2,500 tokens per page, 10M tokens is about 4,000 pages. |
| GitHub API | Used with no key | 60 requests/hour per IP [23] | – | A token raises this to 5,000/hour [23]. Only worth it if Netlify's shared IPs hit the limit. |
| Hugging Face API | Used with no key | 500 calls per 5 min per IP [20] | – | |
| arXiv | Used with no key | API: 1 request every 3 s [16] | – | |
| OpenAI web search | Optional, not in the chain | – | $10 per 1,000 tool calls plus tokens [13] | Uses the existing OpenAI key. About $0.012 per read with gpt-6-luna. |
| Cloudflare Browser Run | Not needed | Workers Free: 10 browser-minutes/day and 1 REST request every 10 s [25] | Workers Paid ($5/mo minimum): 10 browser-hours/month, then $0.09/hour [26] | Has a `/markdown` endpoint [27]. It always identifies itself as a bot [25]. |
| Browserless | Not needed | 1,000 units/month (1 unit is up to 30 s), 2 at once [28] | $25/mo for 20,000 units [28] | REST `/content` and `/scrape` [29] |

Other reader services I did not test: Firecrawl (1,000 credits/month free) [30], ScrapingBee (1,000 trial
credits) [31], ZenRows (5,000 credits/month) [32], Diffbot (10,000 credits/month) [33], Exa ($10 credit/month) [34],
Tavily (1,000 credits/month) [35], Browserbase [36], Steel [37] and Apify [38].

---

## Notes for the article reader (#120)

- **Order and timeouts:** adapter (20 s) → fetch + Readability (12 s) → Jina (30 s) → summary only. Run the reads
  in parallel, with a 60 s deadline for the step. Keep at most 2 requests per host at once.
- **fetch setup:**
  - send a normal desktop Chrome user agent with `Accept` and `Accept-Language` headers;
  - follow redirects;
  - raise Node's response-header limit (Yahoo fails without it);
  - retry once on network errors;
  - stop reading HTML above about 5 MB and fall through to Jina (sec.gov and liquid.ai were 14 MB and 8.6 MB);
  - read PDFs with `unpdf`.
- **Runtime check:** use the rules in [Success rule](#success-rule). Run the block-page phrases only on short
  texts, because some long pages mention "captcha" in their cookie banner.
- **Cap what the writer gets.** Full papers had a median of 87,000 characters, and one SEC filing had 1.5
  million. Trim each article before the writing call. For papers, consider dropping references and appendices.
- **Treat article text as data, not instructions.** Pages can carry hidden text aimed at AI readers. One
  service's pricing page did this during the research. Tell the writer to ignore instructions inside an article.
- **Save the text with its metadata:** method, final URL, status and length. Mark stories with no article so
  the writer uses the summary and the editor can see it.
- **Pages built in the browser** (like the datacenters dashboard) slip through as a shell. That is rare (1 of 83).
  Accept the miss rather than add a browser.

---

## Limits of this study

- **One day, one machine, one home IP.** Netlify functions run from cloud IPs (the default region is US East
  [2]), and some sites block cloud IPs more often. **I did not test from a Netlify IP.** Block rates there may
  be higher.
- **GitHub was flaky that day:** 504s on 4 or 5 of the 8 repo pages in each pass, for every method except the
  API.
- **Product Hunt passed its bot check once** during setup and blocked every scored load.
- **OpenAI web search ran on 51 links, not all 120.**
- **Jina ran without a key only.** I tested no hosted browser service, because that needs an account.
- **The reference text comes from Readability.** That favors fetch and the browser on precision.
- **No page in the sample had a paywall**, so paywall handling is untested.
- **gpt-6-luna labeled the screenshots.** I checked 20 by hand.
- Total OpenAI spend for this study was about $0.90 (271 model calls, 71 web search tool calls).

---

## Sources

1. Netlify — Background functions: https://docs.netlify.com/build/functions/background-functions/
2. Netlify — Function configuration (memory, region, `[functions]` settings): https://docs.netlify.com/build/functions/configuration/
3. Netlify — Next.js legacy runtime troubleshooting (250 MB unzipped): https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/legacy-runtime/troubleshooting/
4. Netlify forum — function size (50 MB zipped, **Unconfirmed**): https://answers.netlify.com/t/function-size-50-mb-but-cant-figure-out-why/75926/16
5. @sparticuz/chromium README: https://github.com/Sparticuz/chromium
6. @sparticuz/chromium releases (v153.0.0, 2026-09-11): https://github.com/Sparticuz/chromium/releases
7. @sparticuz/chromium issue #96 (Netlify, `libnss3`): https://github.com/Sparticuz/chromium/issues/96
8. @sparticuz/chromium issue #24 (`external_node_modules`): https://github.com/Sparticuz/chromium/issues/24#issuecomment-1414107620
9. @sparticuz/chromium issue #280 (macOS): https://github.com/Sparticuz/chromium/issues/280
10. Jina Reader: https://jina.ai/reader/
11. Jina Reader on GitHub (request headers): https://github.com/jina-ai/reader
12. OpenAI — Web search tool: https://developers.openai.com/api/docs/guides/tools-web-search
13. OpenAI — Pricing: https://developers.openai.com/api/docs/pricing
14. OpenAI — gpt-6-luna: https://developers.openai.com/api/docs/models/gpt-6-luna
15. OpenAI — Images and vision: https://developers.openai.com/api/docs/guides/images-vision
16. arXiv — API terms of use: https://info.arxiv.org/help/api/tou.html
17. arXiv — API user manual: https://info.arxiv.org/help/api/user-manual.html
18. arXiv — Accessible HTML: https://info.arxiv.org/about/accessible_HTML.html
19. arXiv blog — HTML papers: https://blog.arxiv.org/2023/12/21/accessibility-update-arxiv-now-offers-papers-in-html-format
20. Hugging Face — Hub rate limits: https://huggingface.co/docs/hub/rate-limits
21. Hugging Face — Hub OpenAPI spec (papers API): https://huggingface.co/.well-known/openapi.json
22. GitHub — Get a repository README: https://docs.github.com/en/rest/repos/contents#get-a-repository-readme
23. GitHub — REST API rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
24. X — oEmbed API: https://docs.x.com/x-for-websites/oembed-api
25. Cloudflare — Browser Run limits: https://developers.cloudflare.com/browser-run/limits/
26. Cloudflare — Browser Rendering pricing: https://developers.cloudflare.com/browser-rendering/pricing/
27. Cloudflare — Markdown endpoint: https://developers.cloudflare.com/browser-rendering/rest-api/markdown-endpoint/
28. Browserless — Pricing: https://www.browserless.io/pricing
29. Browserless — REST APIs: https://docs.browserless.io/rest-apis/intro
30. Firecrawl — Pricing: https://www.firecrawl.dev/pricing
31. ScrapingBee — Pricing: https://www.scrapingbee.com/pricing/
32. ZenRows — Pricing: https://www.zenrows.com/pricing
33. Diffbot — Pricing: https://www.diffbot.com/pricing/
34. Exa — Pricing: https://exa.ai/pricing
35. Tavily — API credits: https://docs.tavily.com/documentation/api-credits
36. Browserbase — Pricing: https://www.browserbase.com/pricing
37. Steel — Pricing: https://steel.dev/pricing
38. Apify — Website Content Crawler: https://apify.com/apify/website-content-crawler
39. Mozilla Readability: https://github.com/mozilla/readability
