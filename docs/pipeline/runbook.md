# Pipeline runbook

What each incident means and what the owner does about it. Read [GLOSSARY.md](../../GLOSSARY.md) for the
words (incident, alert, check, skipped date) and [docs/architecture.html](../architecture.html) for the
stages.

Some keys below come from code that is still in review. Each entry says which job raises it and which PR
adds it. This page is accurate once those PRs are merged: #123 (ops alerts), #129 (run checks), #132 (draft
job), #133 (native commit), #134 (article reader).

## How incidents work

- An incident is one ongoing problem. It has one key, such as `commit-missing:2026-11-09`.
- A job or a check raises the incident each time it sees the problem. The incident stays open until the
  check passes again, then it closes on its own.
- Severity sets what you hear:
  - `critical`: sent to the ops chat at once, and again at each check time while it is open.
  - `warning`: sent once.
  - `info`: never sent. The 18:00 daily summary lists it.
- Outside production nothing is sent. The text goes into the run log (`pipeline_events`) instead.
- Most keys end in a New York date (`YYYY-MM-DD`). When that day is over, the next check run closes the
  incident for you. Marking a date as skipped ("No issue today" on the approval page) turns its checks off
  and closes its incidents.
- Checks run on weekdays at 10:05, 12:00 and 18:00 New York time. Each check also runs at the later times,
  so a fix is noticed at the next one.

## Where to look

- **`pipeline_runs` and `pipeline_events`** (Postgres). Every job writes one run row and a list of events
  (debug, info, warn, error). Start here. The run row has a status, a stats JSON and an error.
- **Admin pages** (#130, behind the approval login):
  - `/admin/incidents`: open and closed incidents.
  - `/admin/runs` and `/admin/runs/<id>`: each run and its events.
  - `/admin/settings`: stage owners (such as `ingest.owner` and `draft.owner`) and other settings.
- **Netlify function logs**: Netlify dashboard, the site, Logs, Functions. The functions are
  `ingest-stories`, `ingest-stories-background`, `run-checks`, `draft-issue-background`, `detect-publish`
  and `detect-publish-catch-up`. Use them when a run row was never written, for example when the database
  was down.
- **The incident link**: each alert carries a link to the board, the issues page or the run. Follow it first.

## Incidents

Eight keys. The date in each key is the issue date in New York time.

### `ingest-run-missing:<date>`

- **Raised by:** `run-checks`, from 10:05 (PR #129).
- **Severity:** critical.
- **Meaning:** `ingest.owner` is `native`, but there is no `ingest-stories` run since 00:00 New York.
  The 09:55 job did not start.
- **Do (check, then retry):** Open `/admin/runs` and look for an `ingest-stories` run today. If there is
  none, check the `ingest-stories` function in Netlify: was it deployed, did it run, did it fail to start.
  Fix that, then start the job again and check that stories arrive. The incident closes at the next check
  time once a run exists.

### `stories-thin:<date>`

- **Raised by:** `run-checks`, from 10:05 (PR #129).
- **Severity:** critical.
- **Meaning:** Fewer stories came in today than half the 8-week median for this weekday. With no history,
  it fires only at zero stories. If the ingest run is still running at 10:05, the check waits for 12:00.
- **Do (check, maybe ignore):** Open the ingest run. Look at each source's line for `failed` or `partial`,
  and fix those (see `source-empty` below). A quiet news day can also cause a thin count. If the run is
  healthy and the day is just quiet, ignore it.

### `source-empty:<source key>:<date>`

- **Raised by:** `run-checks`, from 10:05 (PR #129).
- **Severity:** warning.
- **Meaning:** One source gave zero stories today, and it usually sends on this weekday (at least half of
  the earlier same weekdays). `<source key>` is the key in `src/pipeline/ingest/sources.ts`, for example
  `rundown_ai`. It is not raised when a missing run or a zero total already explains the gap.
- **Do (check, fix, or ignore):** Open the ingest run and read that source's line. `failed` or `partial`
  means an error: read it, fix the cause (Gmail access, a changed sender, a feed that moved), then run
  ingest again. `no_new` means the sender did not email: ignore it. If the sender changed address, see
  [adding-a-source.md](./adding-a-source.md).

### `commit-missing:<date>`

- **Raised by:** `run-checks`, from 12:00 (PR #129).
- **Severity:** warning.
- **Meaning:** No stories are queued for the date and there is no draft. Nobody has approved stories and
  committed them yet.
- **Do (fix):** Open the link (`/approval?date=<date>`), approve the stories and commit. If there is no
  issue today, press "No issue today" and the incident closes.

### `draft-missing:<date>`

- **Raised by:** `run-checks`, from 18:00 (PR #129). The drafting code is in #132, #133 and #134.
- **Severity:** critical.
- **Meaning:** Stories are committed, but no draft with email HTML is ready.
- **Do (check, retry):** Look for a `draft.failed:<date>` incident first. It has the cause. Open
  `/approval/issues` and the draft's run in `/admin/runs`. If the draft failed, retry it from the board.
  If no draft run exists at all, the commit did not start one: check the `draft-issue-background`
  function logs.

### `publish-pending:<date>`

- **Raised by:** `run-checks`, from 18:00 (PR #129).
- **Severity:** warning.
- **Meaning:** The draft is ready, but the issue has no `published_at`. The issue has not gone out, or
  publish detection has not noticed it.
- **Do (fix):** Send the email from GHL. Publish detection marks the issue published when the sent email
  reaches Gmail. If you did send it and this stays open, read the latest `detect-publish` run. If you will
  not send today, press "No issue today".

### `site-check-failed:<date>`

- **Raised by:** `run-checks`, at 18:00 (PR #129).
- **Severity:** critical.
- **Meaning:** The issue is marked published, but the public site is wrong. The alert text names the
  problem: the issue page did not load, returned a status other than 200, or lacks the issue title; or the
  home page did not load or does not list the issue.
- **Do (check, fix):** Open the issue page and the home page. If a page is missing or stale, look at the
  latest Netlify deploy and at the site refresh in the `detect-publish` run. If the title is wrong, fix
  the issue row. The check runs again at the next check time.

### `draft.failed:<date>`

- **Raised by:** the `draft-issue` job, in `src/pipeline/draft/run-draft.ts` (PR #132, carried by #133
  and #134).
- **Severity:** critical.
- **Meaning:** A draft failed at one step: loading the outline, reading articles, writing, checking the
  writing, making the image, building the email, creating the GHL template, or saving. The alert names the
  step. If the draft has no issue date, the key ends in `issue-<id>` instead of a date. A duplicate issue
  title is one known cause; the message then says so.
- **Do (check, fix, retry):** Read the evidence in the alert and the run's events. Fix the cause if it is
  outside the code, for example an API key or a quota. Then press "Retry" on the board. A retry resets the
  draft and runs it again with a new GHL template; the old template stays in GHL. The incident closes when
  a draft is ready. `run-checks` does not close this key at the end of the day, so it stays open until a
  draft succeeds or you resolve it.

## A run that fails to report

`run-checks` has one more alert that is not an incident. If the check job itself throws, it posts
"CRITICAL: run-checks failed" to the ops chat with the error and a link to the run. No incident is opened,
and no checks ran for that time. Open the run, read the error, and fix it. The next check time runs again.
If the text says "No run row was written", the database may be down: check Neon first.

If a `run-checks` run logs a `deadline` warning, Telegram or site calls used up their 20 second budget.
Unsent alerts go out at the next check time. Take no action unless it repeats.
