import { checkIncidentDate, evaluateChecks, needsSiteCheck, type Finding } from "@/src/pipeline/checks/checks";
import { readDayFacts, type DayFacts } from "@/src/pipeline/checks/day-facts";
import { pingHeartbeat, type HeartbeatResult } from "@/src/pipeline/checks/heartbeat";
import { CHECK_TIMES, checkTimeAt, newYorkDay, newYorkTime, type CheckTime } from "@/src/pipeline/checks/schedule";
import { PUBLIC_SITE_URL, readSiteFacts } from "@/src/pipeline/checks/site";
import { buildDailySummary } from "@/src/pipeline/checks/summary";
import {
  listInfoIncidents,
  listOpenIncidents,
  postToOpsChat,
  raiseIncident,
  resendOpenCriticals,
  resolveIncident,
  runLink,
  type Delivery,
  type NotifyOptions,
} from "@/src/pipeline/notify";
import { finishRun, logEvent, startRun, type RunTrigger } from "@/src/pipeline/runs";

/**
 * The check job (#50, #52): at 10:05, 12:00 and 18:00 New York on weekdays it checks the day's outcomes,
 * raises or resolves incidents, and at 18:00 sends the daily summary and the heartbeat. It reads only the
 * database and the public site; it never calls n8n. Outside a check time it does nothing and opens no
 * database connection.
 */

const JOB = "run-checks";
const DAY_MS = 24 * 3_600_000;

export type RunChecksResult =
  | { status: "not_time" }
  | {
      status: "ran";
      runId: string;
      time: CheckTime;
      date: string;
      skipped: boolean;
      failing: string[];
      summary?: Delivery;
      heartbeat?: HeartbeatResult["status"];
    };

export interface RunChecksOptions {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  trigger?: RunTrigger;
  /** The site to check at 18:00. Defaults to the public site. */
  siteUrl?: string;
  /** For the site check and the heartbeat. */
  fetch?: typeof fetch;
  /** Replaces the database read (tests). */
  readFacts?: (date: string) => Promise<DayFacts>;
}

/** Check incidents of earlier dates can no longer pass: their day is over. */
async function closeEarlierDates(date: string, notify: NotifyOptions): Promise<string[]> {
  const stale = (await listOpenIncidents()).filter((alert) => {
    const incidentDate = checkIncidentDate(alert.incidentKey);
    return incidentDate !== null && incidentDate < date;
  });
  for (const alert of stale) {
    await resolveIncident(alert.incidentKey, {
      ...notify,
      note: "Closed: that day is over, so this check no longer runs.",
    });
  }
  return stale.map((alert) => alert.incidentKey);
}

async function silenceSkippedDate(date: string, notify: NotifyOptions): Promise<void> {
  const open = (await listOpenIncidents()).filter((alert) => checkIncidentDate(alert.incidentKey) === date);
  for (const alert of open) {
    await resolveIncident(alert.incidentKey, {
      ...notify,
      note: `Skipped date: no issue today. This check is off for ${date}.`,
    });
  }
}

async function applyFindings(
  findings: Finding[],
  details: { date: string; time: CheckTime },
  notify: NotifyOptions & { runId: bigint },
) {
  for (const finding of findings) {
    if (!finding.failure) {
      await resolveIncident(finding.incidentKey, notify);
      continue;
    }
    await raiseIncident(
      { incidentKey: finding.incidentKey, ...finding.failure, details: { check: finding.check, ...details } },
      notify,
    );
    await logEvent(notify.runId, {
      level: finding.failure.severity === "critical" ? "error" : "warn",
      step: "check",
      message: `${finding.incidentKey}: ${finding.failure.what}`,
      data: { evidence: finding.failure.evidence },
    });
  }
}

/** The 18:00 summary goes out on skipped dates too. Then the heartbeat, which never fails the run. */
async function sendSummary(
  facts: DayFacts,
  context: { env: Record<string, string | undefined>; fetch?: typeof fetch; weekday: string },
  notify: NotifyOptions & { runId: bigint },
) {
  // Info incidents since the previous weekday's summary.
  const since = new Date(newYorkTime(facts.date, "18:00").getTime() - (context.weekday === "Mon" ? 3 : 1) * DAY_MS);
  const [openIncidents, infoIncidents] = await Promise.all([listOpenIncidents(), listInfoIncidents(since)]);
  const summary = await postToOpsChat(buildDailySummary({ facts, openIncidents, infoIncidents }), notify);

  const heartbeat = await pingHeartbeat({
    env: context.env,
    ok: summary === "sent",
    body: `Run ${notify.runId}: summary ${summary}, ${openIncidents.length} open incident(s).`,
    fetch: context.fetch,
  });
  const message =
    heartbeat.status === "sent"
      ? summary === "sent"
        ? "Pinged Healthchecks.io."
        : "Pinged the Healthchecks.io fail URL: the summary did not reach the ops chat."
      : heartbeat.status === "failed"
        ? `Not sent: ${heartbeat.reason}`
        : heartbeat.status === "not_configured"
          ? "Not sent: HEALTHCHECKS_PING_URL is not configured."
          : "Not sent outside production.";
  const level = heartbeat.status === "failed" || heartbeat.status === "not_configured" ? "warn" : "info";
  await logEvent(notify.runId, { level, step: "heartbeat", message });
  return { summary, heartbeat: heartbeat.status };
}

export async function runChecks(options: RunChecksOptions = {}): Promise<RunChecksResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  // Only production has a schedule. A preview runs only with "Run now", at any time, as a full 18:00 pass.
  const time = checkTimeAt(startedAt) ?? (env.APP_ENV === "production" ? null : "18:00");
  if (!time) return { status: "not_time" };

  const { date, weekday } = newYorkDay(startedAt);
  const siteUrl = options.siteUrl ?? PUBLIC_SITE_URL;
  const runId = await startRun({ job: JOB, trigger: options.trigger ?? "schedule" }, startedAt);
  const notify = { runId, now: startedAt, env };

  try {
    const closed = await closeEarlierDates(date, notify);
    const facts = await (options.readFacts ?? readDayFacts)(date);
    const site =
      needsSiteCheck(time, facts) && facts.issue?.slug
        ? await readSiteFacts({ slug: facts.issue.slug, title: facts.issue.title }, { siteUrl, fetch: options.fetch })
        : null;
    const outcome = evaluateChecks(time, facts, { site, siteUrl, runLink: runLink(runId) });

    let failing: string[] = [];
    if (outcome.status === "skipped") {
      await silenceSkippedDate(date, notify);
      await logEvent(runId, { level: "info", step: "check", message: `${date} is a skipped date. Its checks are off.` });
    } else {
      await applyFindings(outcome.findings, { date, time }, notify);
      failing = outcome.findings.flatMap((finding) => (finding.failure ? [finding.incidentKey] : []));
    }
    const resent = await resendOpenCriticals(notify);
    const daily = time === "18:00" ? await sendSummary(facts, { env, fetch: options.fetch, weekday }, notify) : {};

    const skipped = outcome.status === "skipped";
    await finishRun(
      runId,
      {
        status: "succeeded",
        stats: { time, date, skipped, failing, closed, resent: resent.map((item) => item.incidentKey), ...daily },
      },
      now(),
    );
    return { status: "ran", runId: runId.toString(), time, date, skipped, failing, ...daily };
  } catch (error) {
    await finishRun(runId, { status: "failed", error: error instanceof Error ? error.message : String(error) }, now());
    throw error;
  }
}

export function describeRunChecks(result: RunChecksResult): string {
  if (result.status === "not_time") {
    return `Not a check time (${CHECK_TIMES.join(", ")} New York, weekdays). Nothing to do.`;
  }
  const parts = [`Run ${result.runId}: ${result.time} checks for ${result.date}.`];
  if (result.skipped) parts.push("Skipped date: checks are off.");
  else parts.push(result.failing.length > 0 ? `Failing: ${result.failing.join(", ")}.` : "All checks pass.");
  if (result.summary) parts.push(`Summary: ${result.summary}.`);
  if (result.heartbeat) parts.push(`Heartbeat: ${result.heartbeat}.`);
  return parts.join(" ");
}
