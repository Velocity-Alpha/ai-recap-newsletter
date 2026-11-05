# Research: $0 job runners for the native pipeline

Checked on **2026-11-04**. Every fact links to a numbered source in [Sources](#sources), all checked on that
date. Items marked **Unconfirmed** come from secondary sources, from search-result summaries, or could not
be found on an official page. Free tiers change often, so re-check them before you commit.

This extends Part B of [live-news-and-job-runners.md](./live-news-and-job-runners.md). It doesn't repeat
Part B's feature table. Sources from that doc are cited as "Part B [n]". The new constraint is that the owner
will **not** pay the ~$10/month for Trigger.dev Hobby, so only $0 options are considered here.

---

## Summary

**Pick: Trigger.dev Free ($0).** Part B called it "not viable", but that verdict changes once you see that
free-plan waits cost nothing:
- **Hourly schedule limit.** Free schedules can't run more often than once an hour [3]. But `wait.for` waits
  longer than 5 s are not billed [5]. So one hourly run can loop "check, then wait 3 min" to poll every few
  minutes.
- **No Staging.** The Dev environment covers manual staging runs. Tasks run on your own machine through the
  dev CLI [3].
- **Credit.** Estimated usage is **$1.90–$3.20/mo**, inside the **$5 monthly credit** [1]. If the credit runs
  out, tasks stop. You don't get billed [1].
- **What it covers as-is:** 300 s LLM calls with unchanged code, IANA cron with DST [3], and built-in failure
  alerts to 1 destination [2].

**Alternative 1: Inngest Free inside the Next.js app on Netlify ($0).**
- 50k executions/month, and runs pause at the cap [10]. Estimated use is 12k–35k.
- `step.ai.infer` / `step.fetch` send the LLM request from Inngest's servers, so your function isn't running
  while it waits [12][13]. That means a 300 s call doesn't hit Netlify's 60 s limit.
- Catches: timeouts for those offloaded calls are **not documented**. Every other step still runs on
  Netlify. Netlify pauses *all* sites when credits run out [52].

**Alternative 2: Self-hosted pg-boss worker on the Oracle VM ($0).**
- One Node process using pg-boss `schedule()` with a `tz` option [59], retries and backoff [60], an official
  dashboard [62], and a **local** Postgres container.
- **Do not put the queue on Neon.** pg-boss checks for jobs every 2 s [61], so Neon would never scale to zero.
  An always-awake 0.25 CU compute uses about 180 CU-h/month, but Free includes only 100 [70][71].

**New facts that change the picture**
1. **Oracle halved Always Free Ampere A1 on 2026-06-15**, to **2 OCPU / 12 GB** (1,500 OCPU-h, 9,000 GB-h)
   [53][54]. The VM may not be 4 OCPU / 24 GB unless it is grandfathered or on Pay As You Go (**Unconfirmed**)
   [54]. Trigger.dev self-hosted needs at least 7 vCPU / 14 GB [7], so it is out.
2. **GitHub Actions cron now takes an IANA `timezone`** (changelog 2026-03-19) [42][43]. But private repos get
   only $12/month of included compute, and each job is rounded up to a whole minute [44][45]. That rules out
   polling every few minutes.
3. **Hatchet Cloud's free tier is large** (1M runs/month with a card on file) [34]. Its cron is UTC-only [35],
   though, and you still run the worker yourself, on the same VM.

---

## 1. Workload model (updated from Part B B.1)

The timings in this brief replace Part B's. Assumptions: 22 weekdays a month, and 30 days for 24/7 jobs.

| Job | When | Runs/day (weekday) | Runs/month | Wall time/run | Steps/run (for step-metered tools) |
|---|---|---|---|---|---|
| Ingestion | 10:00 ET weekdays | 1 | 22 | 60–300 s (high case 600 s) | 25–75 (6–8 fetches + 10–60 LLM calls + bookkeeping) |
| Draft | On demand, weekdays | 1 | 22 | 60–120 s | ~10–12 |
| Publish poll | 08:00–20:00 ET weekdays, every 2–5 min | 144–360 | 3,168–7,920 | ~5 s | 1–2 |
| Watchdog | Every 5–15 min, 24/7 | 96–288 | 2,880–8,640 | ~3 s | 1–2 |
| **Base** (poll every 3 min, watchdog every 10 min) | | **386** | **9,644** | | |
| **High** (poll every 2 min, watchdog every 5 min) | | **650** | **16,604** | | |

---

## 2. Managed options on free tiers

### 2.1 Limits

| | Monthly quota | Concurrency | Max duration / long LLM call | Cron + timezone | Environments | Run history | Alerts | When exceeded |
|---|---|---|---|---|---|---|---|---|
| **Trigger.dev Free** | **$5 compute credit**. Small-1x $0.0000338/s, micro $0.0000169/s, plus $0.000025 per run [1]. No run cap. | 20 prod, 25 dev [2] | No maximum duration [1]. Waits over 5 s are free [5]. | IANA timezone, DST handled. **No more often than hourly.** Faster crons are rejected at deploy [3]. 10 schedules [1][2]. | Dev + Prod [1]. Staging only on Hobby/Pro [4]. The limits page lists a Free staging concurrency of 10 [2] (**conflict**). | **1 day** [1][2] | **1 destination** (email, Slack or webhook) [2] | "You'll need to upgrade to keep running tasks" [1]. No overage. |
| **Inngest Free** (functions on Netlify) | **50k executions**. An execution is one run or one step, so 5 `step.run` = 6 [10]. | 5 concurrent steps [10][11] | Step up to 2 h, **but capped by the host** [11]. Netlify sync is 60 s (Part B [82]). `step.ai.infer` / `step.fetch` run the request on Inngest's side [12][13]. Their timeout is **not documented**. Run length up to 30 days [11]. | `TZ=America/New_York …` prefix. Doesn't correct for DST in the transition hour [16]. No frequency limit found. | Production, branch, custom, local dev server [17]. 2 active branch deploys on Free [11]. Custom envs on Free **Unconfirmed**. | **24 h** traces [10] | Build your own with `onFailure` or a `inngest/function.failed` handler [19] | "Execution pauses once you hit the free quota" [10] |
| **Upstash Workflow + QStash Free** | **1,000 steps/day** (Workflow) [25]. **1,000 messages/day** (QStash). Retries count as messages [24]. Shared quota **Unconfirmed**. | 10 parallel steps [25]. Queue parallelism 2 [24]. | `context.call` runs the HTTP call from Upstash, "up to 12 hours" [26]. The pricing table says 15 min max response time on Free [25] (**conflict**). Each step is still a Netlify call (60 s). | `CRON_TZ=America/New_York …`, all IANA zones [27]. 10 active schedules [24]. | Local dev server (in-memory, dev only) [29]. A separate cloud staging setup is **Unconfirmed**. | **3 days** logs and DLQ [24][25] | `failureFunction` / `failureUrl`, DLQ with resume [28]. No built-in email. | Soft limits. If you keep going over, steps return errors and land in the DLQ [25]. |
| **Cloudflare Workers Free** (Workflows + Cron Triggers) | 100k requests/day [31] | 100 concurrent Workflow instances [30] | **10 ms CPU per step**. Wall clock unlimited, and I/O waits don't count [30][31]. Cron invocation up to 15 min wall clock [31]. | **UTC only** [32]. 5 Cron Triggers per account [31]. | Separate Workers (you set them up) | 3 days of instance state [30] | **Unconfirmed** (none found) | Error 1027 once the daily request limit is reached [31] |
| **Hatchet Cloud** (no card / card on file) | 2,000 runs/day, or 1M/month then $30/M [34] | 2,000 / 10,000 slots [34] | Default task timeout 60 s, configurable [36]. **You run the worker yourself** [34]. | **UTC only** [35]. 10 / 1,000 crons [34]. | 1 / 10 tenants [34] | 1 / 7 days [34] | Tenant email and Slack failure alerts. An open bug can skip alerts [37]. | "Tasks will get dropped" [34] |
| **Restate Cloud Free** | 50k actions/month [40] | **Unconfirmed** | You host the services yourself [40] | **No native cron.** You build it from delayed calls [41]. | **Unconfirmed** | **Unconfirmed** | **Unconfirmed** | **Unconfirmed** |
| **GitHub Actions** | Public repo: free standard runners. Private repo: **$12/month included**, Linux x64 $0.006/min, each job rounded up to a minute [44][45]. | — | 6 h per job [46] | `timezone: "America/New_York"` [42]. **Minimum interval 5 min.** Delays at high load, especially at the top of the hour, and "some queued jobs may be dropped" [42]. | GitHub Environments in private repos need Pro or Team [47] | Run logs (retention not checked) | Email to the user who created or last edited the cron. The docs contradict each other [48]. | Usage blocked once the included amount is used, if no payment method is on file [44] |
| **Netlify only** (already paid for) | Plan credits: compute 10 credits per GB-h [51] | Not documented | Scheduled 30 s, background 15 min [49][50] | **UTC only** [50] | Scheduled functions fire only on the published production deploy [50] | Plan-dependent [51] | Build your own | **All sites on the team pause** when credits run out, unless auto-recharge is on [52] |

### 2.2 Fit for this workload

| Option | Fits? | Estimated use | Main catch |
|---|---|---|---|
| **Trigger.dev Free** | **Yes, with the sweeper pattern (§4.1)** | Base: 48,600 compute-s ≈ $1.64 + about 10.6k runs ≈ $0.27, so **$1.91**. High: 81,360 s ≈ $2.75 + about 17.6k runs ≈ $0.44, so **$3.19**. Both fit the $5 credit [1]. | Hourly schedules, 1-day logs, no Staging. It's a separate deploy (`/trigger`) with a Prisma 7 extension in beta (Part B [68]). |
| **Inngest Free + Netlify** | **Yes, if every LLM call goes through `step.ai.infer` / `step.fetch`** | Base about 11.5k executions. High about 35k, if poll and watchdog each use one step [10]. Netlify: about 30–100 credits/month (my estimate at 1 GB × 1–2 s per invocation) [51]. | Offloaded-call timeouts are undocumented [12][13]. `step.fetch` can't be nested in `step.run` [12]. `step.ai.infer` has no streaming yet [13]. Netlify credits are shared with the website [52]. |
| **Upstash Workflow + QStash** | Borderline | Weekday base about 470 steps, high about 735, plus retries, against 1,000/day [24][25] | Daily cap gets close at the high polling rate. 3-day logs. No hosted staging. |
| **Cloudflare Workflows** | Not recommended | Well inside 100k/day | 10 ms CPU per step is tight for Prisma, HTML parsing and prompt building [30][31]. Workers Free has a 3 MB bundle limit, and Prisma may not fit [33]. UTC cron [32]. It's a second runtime to maintain. |
| **Hatchet Cloud** | Works, but needs the VM | About 650 runs/day at the high rate, under 2,000/day [34] | UTC cron [35], worker on the n8n box, and 1-day history without a card [34] |
| **Restate Cloud** | No | — | No cron [41] |
| **GitHub Actions** (private repo) | Only for the two daily jobs | Ingestion + draft is about 44 jobs × about 6 min ≈ 264 min ≈ $1.58 of the $12 [45]. Polling every 5 min would need at least 3,168 min ≈ $19. | 5-minute floor, delays and dropped jobs [42] |
| **Netlify only** | Yes, with DIY | See Part B B.3 | You build retries, the ledger, alerts and DST handling yourself. Running out of credits takes the whole site down [52]. |

### 2.3 Notes on specific options

**Inngest: does checkpointing or streaming get around Netlify's 60 s limit?**
- **Checkpointing** is on by default in TS SDK v4. It runs steps eagerly in the same request on your server
  [14]. The docs say to set `maxRuntime` just below the platform's maximum, which means **the host's limit
  still applies** [14]. So it saves round-trips, not time.
- **Streaming** (`streaming: true`) is documented for Vercel Fluid / Edge and Express. **Netlify isn't
  mentioned** [15].
- **What does work is offloading.**
  - With `step.ai.infer`, "your function is not executing while the request is in progress" [13].
    Providers: OpenAI (and OpenAI-compatible APIs such as Perplexity), Anthropic, Gemini, Grok and Azure
    OpenAI [13].
  - `step.fetch` does the same for any HTTP call [12]. Its docs show it being passed to SDKs (with the AI
    SDK, set `maxRetries: 0`) [12]. Passing it to the `openai` client's `fetch` option is **Unconfirmed**.
  - Still to check: the maximum wait for either call (the 2 h step cap probably applies, **Unconfirmed**)
    [11][23], whether they count as executions [10], and whether `response_format` / Responses-API bodies
    pass through (**Unconfirmed**).
- **Idempotency:** event IDs and the function's `idempotency` key dedupe for 24 h [18].

**Upstash:** `context.call` also offloads, and supports retries with exponential backoff [26]. Upstash itself
recommends a local tunnel if you want dev runs to show in the console. The local dev server's runs aren't
logged there [29].

**Netlify (extends Part B):**
- Background functions run on all credit-based plans, including Free [49].
- Scheduled functions run on all plans and are UTC-only [50].
- New risk: pipeline compute shares credits with the website. When credits run out, every site on the team
  pauses ("Site not available"). Auto-recharge is off by default [52].
- **cron-job.org** is a free external trigger. It runs jobs as often as once a minute, has a 30 s request
  timeout, sends failure emails and keeps the last 50 runs [75]. It still has to hand off to a background
  function. Per-job timezone support was **not confirmed** on its FAQ [75].

---

## 3. Self-hosting on the Oracle VM

### 3.1 The box itself

- **Capacity may be half of what was assumed.** Oracle's current page says Always Free A1 is 1,500 OCPU-h and
  9,000 GB-h per month, "equivalent to 2 OCPUs and 12 GB" [53]. InfoQ dates the change to **2026-06-15**.
  - Free-only instances above the limit were shut down until resized.
  - Grandfathered instances may keep running, but may not be recreatable at the old size.
  - Pay As You Go tenancies reportedly still get 4 OCPU / 24 GB free (**Unconfirmed**; Oracle hasn't said
    so) [54].
  - **Check the VM's real shape** (`nproc`, `free -g`) and the tenancy type.
- **Idle reclamation.** Oracle may reclaim an Always Free instance if, over 7 days, three things are true:
  95th-percentile CPU is below 20%, network is below 20%, and (on A1) memory is below 20% [53]. A mostly-idle
  n8n + worker box is close to that.
- **Correlated failure.** Today n8n is the working pipeline. If the new runner shares the VM, one VM outage,
  reclamation, or disk-full event stops **both the old and the new pipeline at once**, and nothing off-box
  notices.
  - Fix: an external dead-man's switch. **Healthchecks.io Hobbyist is $0 for 20 checks.** It supports cron
    schedules with a timezone and grace times [73][74]. The worker pings after each run, and Healthchecks
    emails you when a ping is late.
- **Neon must stay asleep.** Neon Free gives 100 CU-h/month and suspends after 5 min idle, and you can't turn
  that off on Free [70][71][72].
  - A queue that polls Neon every 2 s keeps a 0.25 CU compute up 24/7: 0.25 × 720 h = **180 CU-h**.
  - On Free, that suspends compute until next month [70]. On Launch it is about **$19/month** at $0.106/CU-h
    [70].
  - **Run any queue or orchestrator database on the VM**, and touch Neon only for real work.
  - The same arithmetic applies to the workload itself, whatever runner you pick. A watchdog that queries
    Neon every 5–10 min, around the clock, keeps it awake almost all the time.

### 3.2 Candidates

| Option | What you run | arm64 images | RAM / CPU | Ops burden | License | Verdict |
|---|---|---|---|---|---|---|
| **Trigger.dev v4 self-hosted** | Webapp, Postgres, Redis, ClickHouse ≥25.8, built-in registry and object storage, supervisor, runners [7] | The docs list "ARM support: Yes" [8]. The image manifest showed no platform list [9] (**Unconfirmed**). | **Minimum 3 vCPU / 6 GB (webapp) + 4 vCPU / 8 GB (worker)** [7] | High. **No checkpoints** self-hosted, so waits hold resources [8]. "Unlikely to result in a production-ready deployment" from the guide alone [7]. | Apache 2.0 (not re-checked) | **No.** It doesn't fit even 4 OCPU / 24 GB alongside n8n. |
| **Inngest self-hosted** (`inngest start`) | One Go binary. SQLite + embedded Redis by default. Postgres/Redis optional. Dashboard on :8288 [20]. | **Yes**: `inngest/inngest` v1.49.0 (2026-10-23) is amd64 + arm64 [22] | Not documented [20] (**Unconfirmed**, probably a few hundred MB) | Medium. Single-node mode is labelled **beta**, and self-hosted support isn't guaranteed [20]. The SQLite file needs a persistent volume. Old Postgres rows aren't cleaned up. Protect the dashboard and `/metrics` yourself, for example with Caddy auth [20]. | **SSPL**, with delayed Apache 2.0 publication. SDKs are Apache 2.0 [21]. | Possible. You get the Inngest developer experience without the 50k cap, but it's beta and shares the box. |
| **Hatchet Lite** | One image (engine, API, UI) + Postgres [38] | **Yes**: linux/amd64 + linux/arm64 [39] | Not documented [38] (**Unconfirmed**) | Medium. Meant for "development, testing, or low-throughput production" [38]. Cron is UTC [35]. | MIT [34] | Possible, but UTC cron and a heavier stack than pg-boss |
| **Windmill CE** | Postgres, server, workers, LSP, Caddy [55] | **Yes**: linux/amd64 + linux/arm64 [57] | Rule of thumb: "1 worker per 1 vCPU and 1–2 GB RAM" [55][56] | Medium–high. Scripts run inside Windmill, not in your app, so the repo's Prisma code has to be packaged for it. | AGPLv3 [56] | No. Too heavy for a 2 OCPU shared box, and a poor fit for in-repo TypeScript. |
| **pg-boss worker** (+ `@pg-boss/dashboard`) | One Node process (your code) + a small local Postgres container | Node and `postgres` official images are multi-arch (**Unconfirmed**, not checked here) | Not documented. Estimate 150–300 MB for Node + Prisma and about 100 MB for Postgres (**Unconfirmed**). | Low–medium. You own deploys, updates, Postgres backups and alerting (Healthchecks.io). | MIT [63] | **Best self-hosted fit** (Alternative 2) |
| **Graphile Worker** | Same shape as pg-boss | Same as above | Similar (**Unconfirmed**) | Low–medium | MIT (not re-checked) | Second choice. **Crontab is UTC-only** [64]. Needs Node ≥22.18 [65]. |
| **DBOS Transact** (library) | Durable workflows inside your Node process. Postgres system DB [68]. | n/a (library) | Your process + Postgres | Low–medium. Scheduler polls every 30 s and uses LISTEN/NOTIFY [68], so keep it off Neon. | Open source, "free forever" [69] | Interesting, but the **dashboard (Conductor) starts at $99/mo** [69] and nothing free was found |

**What pg-boss gives you** (v12.38.0, Node ≥22.12, Postgres ≥13) [58]:
- `schedule(name, cron, data, { tz })`, checked every 30 s. Multiple instances still send only one job [59].
- Missed runs can be caught up with `missed: 'once'` [59].
- Retries with exponential backoff. Defaults: 2 retries, 15-minute `expireInSeconds` [60]. Raise
  `expireInSeconds` above the longest ingestion run.
- `singletonKey` / `singletonSeconds` for idempotency [60].
- Dead-letter queues [58].
- The dashboard shows jobs, queues and schedules, supports retry and cancel, and has basic auth and a
  read-only mode [62]. Put it behind Caddy.

**croner** is the right tool if you want an in-process timer without persistence. Use its `timezone` option,
not `utcOffset`, which ignores DST. `protect` blocks overlapping runs [66]. But pg-boss's persisted schedules
already cover timezones, so croner isn't needed.

---

## 4. Recommendation

### 4.1 Pick: Trigger.dev Free

**Why:**
- It is the managed, Trigger.dev-like experience at $0.
- Long LLM calls work with **unchanged code**, because there is no duration limit [1].
- Retries, idempotency keys and run-failure alerts are built in (Part B [65]–[67]; [2]).
- Nothing touches Netlify credits or the VM.
- The cron timezone handles DST [3].
- Estimated use ($1.91–$3.19) is about 40–65% of the $5 credit [1].

**How it fits the Free limits:**
- **Schedules (3 of 10):**
  - Ingestion: `0 10 * * 1-5`.
  - Publish sweeper: `0 8-19 * * 1-5`, hourly.
  - Watchdog sweeper: `0 * * * *`.
  - All three use `America/New_York` and `environments: ["PRODUCTION"]` [3].
- **Sweeper pattern.** Each hourly run fires a child poll task, then calls `wait.for({ minutes: 3 })`, and
  repeats until about 3 minutes before the hour ends. Waits over 5 s are free. Machines are snapshotted 60 s
  into a wait and release their concurrency slot [5][6]. Example:

  ```ts
  // Free plan: schedules fire at most hourly, so loop inside the run. Waits >5 s aren't billed.
  export const publishSweeper = schedules.task({
    id: "publish-sweeper",
    cron: { pattern: "0 8-19 * * 1-5", timezone: "America/New_York", environments: ["PRODUCTION"] },
    run: async (payload) => {
      const hourEnd = new Date(payload.timestamp).getTime() + 60 * 60_000;
      while (Date.now() < hourEnd - 3 * 60_000) {
        await publishPoll.trigger({}, { idempotencyKey: `poll-${Math.floor(Date.now() / 180_000)}` });
        await wait.for({ minutes: 3 });
      }
    },
  });
  ```
  (The exact `cron` object shape follows [3] and Part B [62]. Check it against the SDK version you install.)
- **Run history.** Free keeps 1 day [1]. Write a small run ledger table in Neon (job, slot, status, error).
  It also serves as the idempotency record.
- **Alerts.** Use the single destination [2] for a webhook or email on run failure. If the credit runs out,
  runs **never start**, so no failure alert fires. Add Healthchecks.io checks for "ingestion finished" and
  "sweeper alive" [73][74].

**Dev/staging vs production:**
- **Production:** `npx trigger.dev deploy` from CI on merge to `main`. Production env vars point at Neon's
  main branch.
- **Staging (manual only):** the **Dev environment**.
  - Run `npx trigger.dev dev` locally with a `.env` that points at a Neon staging branch and sandbox API keys.
  - Trigger runs from the dashboard or from the staging Netlify deploy, using the Dev secret key.
  - Dev schedules fire only while the CLI is running, and these schedules are production-only anyway [3].
  - Dev runs have no per-run charge [1] and run on your machine [3].
- **If you later want a hosted Staging or 7-day logs,** that is Hobby at $10/mo (Part B).

**Trade-offs, plainly:**
- **Account for the free credit monthly.** Each month is capped at $5 of compute. It holds at about 2× the
  estimate.
- **The sweeper is a workaround.** If Trigger.dev changes free-plan rules, polling breaks.
- **You debug from your own ledger after 24 h.**
- **Prisma 7 + `prismaExtension` is beta** (Part B [68]). Test the build early.

### 4.2 Alternative 1: Inngest Free on Netlify

- **Choose it if** you'd rather keep everything in the Next.js app, with no second deploy target and no
  sweeper workaround. Cron runs at any frequency with `TZ=` [16], and steps retry individually (Part B [76]).
- **Required:** every LLM call becomes a top-level `step.ai.infer` or `step.fetch` [12][13]. Every other step
  must finish within Netlify's 60 s.
- **Add yourself:** failure alerts through `inngest/function.failed` [19], plus Healthchecks.io.
- **Environments:** production syncs to the Netlify production URL. Staging means the local Inngest Dev
  Server, or a branch environment for a Netlify branch deploy (2 active on Free) [11][17]. Register the cron
  trigger only in production (Part B [75]).
- **Biggest risks:**
  - The offloaded-call timeout isn't documented.
  - Runs pause at 50k executions [10].
  - The pipeline draws on the same Netlify credits that keep the site online [52].

### 4.3 Alternative 2: pg-boss worker on the Oracle VM

- **Choose it if** you want no vendor quotas and full control, and you accept running it yourself.
- **The setup:** one Docker Compose stack next to n8n.
  - `postgres` with a local volume.
  - The worker, built from this repo as an arm64 image, for example on GitHub Actions.
  - `@pg-boss/dashboard` behind Caddy basic auth [62].
  - pg-boss schedules with `tz: "America/New_York"` [59] and singleton keys for idempotency [60].
- **Healthchecks.io** for alerts [73].
- **Environments:** two Compose services, `worker-prod` and `worker-staging`, each with its own env file and
  queue database and its own Neon branch. Staging runs with schedules turned off, and you queue jobs from the
  dashboard or a CLI script.
- **Biggest risks:**
  - It shares a box with n8n, with reclamation and capacity unknowns [53][54].
  - You own patching and Postgres backups.
- **Variant:** Hatchet Cloud keeps run history and alerts off the box. Its 5-minute schedule timeout [36]
  fails tasks that no worker picks up, so a dead VM gets noticed. But its cron is UTC-only [35] and it adds a
  second vendor.

**Not recommended:**
- Cloudflare Workflows: 10 ms CPU, 3 MB bundle and UTC cron [30][32][33].
- Restate: no cron [41].
- GitHub Actions for polling: 5-minute floor and dropped jobs [42].
- Trigger.dev self-hosted and Windmill: too heavy [7][55].
- Netlify-only: possible, but you'd build the runner yourself (Part B).

---

## 5. Unconfirmed items and biggest uncertainties

1. **The VM's real size and tenancy type.** It's 2 OCPU / 12 GB unless grandfathered or Pay As You Go
   [53][54]. This decides whether self-hosting anything beyond pg-boss is realistic.
2. **The Neon plan.** If the project is on Free (100 CU-h), the watchdog and poll queries alone may use up
   compute, with any runner [70][71].
3. **How long Inngest `step.ai.infer` / `step.fetch` will wait, and whether they count as executions**
   [10][12][13].
4. **Trigger.dev Free staging.** The limits page lists Free staging concurrency [2], while the deploy docs say
   Staging is Hobby/Pro only [4]. Also, will free-plan rules on long-waiting runs stay stable?
5. **Prisma 7 with Trigger.dev's `prismaExtension`** is beta (Part B [68]).
6. Whether **Upstash QStash messages and Workflow steps share** one 1,000/day quota [24][25], and the
   15-minute vs 12-hour `context.call` conflict [25][26].
7. **Self-hosted RAM** for Inngest and Hatchet Lite isn't published [20][38]. Measure it on the box.
8. Trigger.dev self-hosted arm64 image manifests [8][9]. Hatchet's skipped-alert bug [37]. The GitHub
   scheduled-workflow notification recipient [48]. Whether cron-job.org supports a timezone per job [75].
   Restate's free-tier details beyond 50k actions [40].

---

## Sources

All checked 2026-11-04. "Via search" means the fact came from a search-result summary of that official page
rather than a direct fetch.

1. Trigger.dev — Pricing (Free $5 credit, 10 schedules, 1-day logs, machine prices, "upgrade to keep running"): https://trigger.dev/pricing
2. Trigger.dev — Limits (concurrency, schedules, alert destinations, log retention): https://trigger.dev/docs/limits
3. Trigger.dev — Scheduled tasks (Free hourly minimum, IANA + DST, `environments`, dev CLI): https://trigger.dev/docs/tasks/scheduled
4. Trigger.dev — Deployment overview (Staging only on Hobby and Pro): https://trigger.dev/docs/deployment/overview
5. Trigger.dev — Wait for (waits >5 s not billed, snapshot at 60 s, concurrency slot): https://trigger.dev/docs/wait-for
6. Trigger.dev — How it works (CRIU checkpoints, paused time not charged): https://trigger.dev/docs/how-it-works
7. Trigger.dev — Self-hosting with Docker (v4 components, minimum CPU/RAM, no checkpoints): https://trigger.dev/docs/self-hosting/docker
8. Trigger.dev — Self-hosting overview (feature table: ARM yes, checkpoints no): https://trigger.dev/docs/self-hosting/overview
9. Trigger.dev — GHCR image page: https://github.com/triggerdotdev/trigger.dev/pkgs/container/trigger.dev
10. Inngest — Pricing (Free 50k executions, 5 concurrent steps, 24 h traces, pause at quota, execution definition): https://www.inngest.com/pricing
11. Inngest — Usage limits (2 h step cap subject to host, 30-day runs, 2 branch deploys on Free): https://www.inngest.com/docs/usage-limits/inngest
12. Inngest — `step.fetch`: https://www.inngest.com/docs/features/inngest-functions/steps-workflows/fetch
13. Inngest — `step.ai.infer` / AI orchestration: https://www.inngest.com/docs/features/inngest-functions/steps-workflows/step-ai-orchestration
14. Inngest — Checkpointing: https://www.inngest.com/docs/setup/checkpointing.md (also https://www.inngest.com/docs/durable-execution/guides-and-advanced/checkpointing.md, via search)
15. Inngest — Serving functions (streaming guidance): https://www.inngest.com/docs/learn/serving-inngest-functions
16. Inngest — Scheduled functions (`TZ=` prefix, DST note): https://www.inngest.com/docs/guides/scheduled-functions
17. Inngest — Environments: https://www.inngest.com/docs/platform/environments
18. Inngest — Handling idempotency (24 h): https://www.inngest.com/docs/guides/handling-idempotency
19. Inngest — Failure handlers and `inngest/function.failed` (via search): https://www.inngest.com/docs/features/inngest-functions/error-retries/failure-handlers, https://www.inngest.com/docs/reference/system-events/inngest-function-failed
20. Inngest — Self-hosting: https://www.inngest.com/docs/self-hosting and https://www.inngest.com/docs/platform-and-operations/self-host-inngest.md
21. Inngest — GitHub repo (SSPL + DOSP Apache 2.0): https://github.com/inngest/inngest
22. Docker Hub — `inngest/inngest` tags API (arm64 and amd64): https://hub.docker.com/v2/repositories/inngest/inngest/tags?page_size=5
23. Inngest — Timeouts (via search): https://www.inngest.com/docs/durable-execution/guides-and-advanced/cancellation/timeouts
24. Upstash — QStash pricing (1,000 messages/day, 10 schedules, 3-day logs, soft limits): https://upstash.com/pricing/qstash
25. Upstash — Workflow pricing (1,000 steps/day, 15 min response, behaviour when exceeded): https://upstash.com/pricing/workflow
26. Upstash — `context.call`: https://upstash.com/docs/workflow/basics/context/call
27. Upstash — QStash schedules (`CRON_TZ`): https://upstash.com/docs/qstash/features/schedules
28. Upstash — Handle failed runs: https://upstash.com/docs/workflow/howto/failures
29. Upstash — Local development (via search): https://upstash.com/docs/qstash/howto/local-development, https://upstash.com/docs/workflow/howto/local-development/local-tunnel
30. Cloudflare — Workflows limits: https://developers.cloudflare.com/workflows/reference/limits/
31. Cloudflare — Workers limits: https://developers.cloudflare.com/workers/platform/limits/
32. Cloudflare — Cron Triggers (UTC): https://developers.cloudflare.com/workers/configuration/cron-triggers/
33. Prisma — Deploy to Cloudflare (v7, 3 MB free limit, Neon adapter): https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare
34. Hatchet — Pricing (no-card vs card-on-file limits, MIT, you run the workers): https://hatchet.run/pricing
35. Hatchet — Cron runs (UTC, missed runs not replayed): https://docs.hatchet.run/home/cron-runs
36. Hatchet — Timeouts (60 s default execution, 5 min schedule timeout): https://docs.hatchet.run/home/timeouts
37. Hatchet — Alerting config and skipped-alert bug (via search): https://docs.hatchet.run/self-hosting/configuration-options, https://github.com/hatchet-dev/hatchet/issues/5340
38. Hatchet — Hatchet Lite and self-hosting overview: https://docs.hatchet.run/self-hosting/hatchet-lite, https://docs.hatchet.run/self-hosting
39. Hatchet — `hatchet-lite` GHCR (amd64 + arm64): https://github.com/hatchet-dev/hatchet/pkgs/container/hatchet%2Fhatchet-lite
40. Restate — Cloud public launch, 2025-09-30 (50k actions/month): https://restate.dev/blog/announcing-restate-cloud-public. Also https://restate.dev/cloud (via search; the page didn't render).
41. Restate — Cron guide (no native cron; via search): https://docs.restate.dev/guides/cron
42. GitHub — Events that trigger workflows, `schedule` (timezone, 5 min minimum, delays, drops): https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
43. GitHub Changelog — Actions late March 2026 updates, 2026-03-19 (via search): https://github.blog/changelog/2026-03-19-github-actions-late-march-2026-updates/
44. GitHub — Actions billing ($12 included on Free; usage blocked without a payment method): https://docs.github.com/en/billing/concepts/product-billing/github-actions
45. GitHub — Runner pricing ($0.006/min Linux x64; rounding up per job): https://docs.github.com/en/billing/reference/actions-runner-pricing
46. GitHub — Actions limits (6 h per job): https://docs.github.com/en/actions/reference/limits
47. GitHub — Managing environments (private repos need Pro or Team): https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
48. GitHub — Notifications for workflow runs (via search): https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs
49. Netlify — Background functions (all credit-based plans, 15 min, 2 retries): https://docs.netlify.com/build/functions/background-functions/
50. Netlify — Scheduled functions (UTC, 30 s, production deploys only): https://docs.netlify.com/build/functions/scheduled-functions/
51. Netlify — Pricing (credits per plan, compute 10 credits per GB-h): https://www.netlify.com/pricing/
52. Netlify — Billing FAQ for credit-based plans (all projects pause; auto-recharge off by default): https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/
53. Oracle — Always Free resources (A1 1,500 OCPU-h / 9,000 GB-h ≈ 2 OCPU / 12 GB; idle reclamation): https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
54. InfoQ — Oracle Cloud free tier limits, July 2026 (secondary; effective 2026-06-15, Pay As You Go reports): https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/
55. Windmill — Self-host docs: https://www.windmill.dev/docs/advanced/self_host
56. Windmill — GitHub repo (AGPLv3, worker sizing rule of thumb): https://github.com/windmill-labs/windmill
57. Windmill — GHCR image (amd64 + arm64): https://github.com/windmill-labs/windmill/pkgs/container/windmill
58. pg-boss — Home (v12.38.0, Node ≥22.12, Postgres ≥13, features): https://pgboss.io/
59. pg-boss — Scheduling (`tz`, 30 s checks, `missed`): https://pgboss.io/api/scheduling
60. pg-boss — Jobs (retry, backoff, singleton, expiry defaults): https://pgboss.io/api/jobs
61. pg-boss — Workers (2 s polling default, opt-in LISTEN/NOTIFY): https://pgboss.io/api/workers
62. pg-boss — Dashboard: https://pgboss.io/dashboard
63. pg-boss — GitHub (MIT): https://github.com/timgit/pg-boss
64. Graphile Worker — Cron (UTC only): https://worker.graphile.org/docs/cron
65. Graphile Worker — Requirements: https://worker.graphile.org/docs/requirements
66. Croner — Configuration (`timezone`, `utcOffset` DST caveat, `protect`): https://croner.56k.guru/usage/configuration/
67. DBOS — Scheduled workflows (`cronTimezone`, exactly-once per schedule): https://docs.dbos.dev/typescript/tutorials/scheduled-workflows
68. DBOS — Configuration (Postgres system DB, LISTEN/NOTIFY, 30 s scheduler polling): https://docs.dbos.dev/typescript/reference/configuration
69. DBOS — Pricing (Conductor Pro $99/mo; Transact free): https://www.dbos.dev/pricing
70. Neon — Pricing (Free 100 CU-h, suspended when used up; Launch $0.106/CU-h): https://neon.com/pricing
71. Neon — Plans (0.25 CU size, CU-h formula, 5-min scale-to-zero fixed on Free): https://neon.com/docs/introduction/plans
72. Neon — Scale to zero: https://neon.com/docs/introduction/scale-to-zero
73. Healthchecks.io — Pricing (Hobbyist $0, 20 checks): https://healthchecks.io/pricing/
74. Healthchecks.io — Configuring checks (cron + time zone, grace time): https://healthchecks.io/docs/configuring_checks/
75. cron-job.org — FAQ (free, as often as every minute, 30 s timeout, failure emails): https://cron-job.org/en/faq/
