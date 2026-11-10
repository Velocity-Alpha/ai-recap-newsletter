import { resolveAlert } from "@/src/pipeline/alerts";
import { dayIncidentDate, evaluateChecks, needsSiteCheck, type Finding } from "@/src/pipeline/checks/checks";
import { readDayFacts, type DayFacts } from "@/src/pipeline/checks/day-facts";
import { OUTSIDE_CALLS_BUDGET_MS, withDeadline } from "@/src/pipeline/checks/deadline";
import { pingHeartbeat, type HeartbeatResult } from "@/src/pipeline/checks/heartbeat";
import {
  CHECK_TIMES,
  checkTimeAt,
  newYorkDay,
  newYorkTime,
  shiftDate,
  type CheckTime,
} from "@/src/pipeline/checks/schedule";
import { PUBLIC_SITE_URL, readSiteFacts } from "@/src/pipeline/checks/site";
import { buildDailySummary } from "@/src/pipeline/checks/summary";
import {
  listInfoIncidents,
  listOpenIncidents,
  opsChannelFromEnv,
  postToOpsChat,
  raiseIncident,
  resendOpenCriticals,
  resolveIncident,
  runLink,
  type AlertChannel,
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
  /** For Telegram, the site check and the heartbeat. */
  fetch?: typeof fetch;
  /** Replaces the database read (tests). */
  readFacts?: (date: string) => Promise<DayFacts>;
  /** How long Telegram and site calls may run in total. Defaults to OUTSIDE_CALLS_BUDGET_MS. */
  budgetMs?: number;
}

type RunNotify = NotifyOptions & { runId: bigint; now: Date };
type OpenIncident = Awaited<ReturnType<typeof listOpenIncidents>>[number];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Closes incidents that no check will resolve: one combined message instead of one "resolved" each, and
 * only for the incidents the owner was told about. A same-day fix still goes through resolveIncident, one
 * message per incident (#123).
 */
async function closeTogether(incidents: OpenIncident[], headline: (count: number) => string, notify: RunNotify) {
  for (const incident of incidents) await resolveAlert(incident.incidentKey, notify.now);
  const told = incidents.filter((incident) => incident.severity !== "info" && incident.notifiedAt !== null);
  if (told.length === 0) return;
  const lines = told.map((incident) => `- ${incident.severity.toUpperCase()} ${incident.incidentKey}: ${incident.message}`);
  await postToOpsChat([`RESOLVED: ${headline(told.length)}`, ...lines].join("\n"), notify);
}

/** Incidents of earlier dates that end with their day (`dayIncidentDate`): nothing can resolve them any more. */
async function closeEarlierDates(date: string, notify: RunNotify): Promise<string[]> {
  const stale = (await listOpenIncidents()).filter((alert) => {
    const incidentDate = dayIncidentDate(alert.incidentKey);
    return incidentDate !== null && incidentDate < date;
  });
  await closeTogether(
    stale,
    (count) => `closed ${plural(count, "incident")} from earlier days. Their day is over.`,
    notify,
  );
  return stale.map((alert) => alert.incidentKey);
}

async function silenceSkippedDate(date: string, notify: RunNotify): Promise<void> {
  const open = (await listOpenIncidents()).filter((alert) => dayIncidentDate(alert.incidentKey) === date);
  await closeTogether(
    open,
    (count) => `${date} is a skipped date (no issue today), so its checks are off. Closed ${plural(count, "incident")}.`,
    notify,
  );
}

/** The ops channel with the run's time limits. Undefined lets notify record why it is not configured. */
function opsChannel(env: Record<string, string | undefined>, fetchImpl: typeof fetch): AlertChannel | undefined {
  if (env.APP_ENV !== "production") return undefined;
  const result = opsChannelFromEnv(env, fetchImpl);
  return result.ok ? result.channel : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One message when the run throws. It must never hide the original error. */
async function reportFailure(error: unknown, run: { time: CheckTime; date: string; runId?: bigint }, notify: NotifyOptions) {
  const text = [
    `CRITICAL: run-checks failed. The ${run.time} checks for ${run.date} stopped.`,
    `Error: ${errorText(error).replace(/\s+/g, " ").trim().slice(0, 500)}`,
    run.runId === undefined ? "No run row was written. The database may be down." : `Link: ${runLink(run.runId)}`,
  ].join("\n");
  await postToOpsChat(text, notify).catch(() => undefined);
}

async function applyFindings(
  findings: Finding[],
  details: { date: string; time: CheckTime },
  notify: RunNotify,
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
  context: { env: Record<string, string | undefined>; fetch: typeof fetch; weekday: string },
  notify: RunNotify,
) {
  // Info incidents since the previous weekday's summary: Friday's on a Monday.
  const since = newYorkTime(shiftDate(facts.date, context.weekday === "Mon" ? -3 : -1), "18:00");
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
  // Netlify stops this function at 30 s (deadline.ts). The heartbeat keeps its own 5 s after the budget.
  const baseFetch = options.fetch ?? fetch;
  const deadline = AbortSignal.timeout(options.budgetMs ?? OUTSIDE_CALLS_BUDGET_MS);
  const outsideFetch = withDeadline(baseFetch, deadline);
  const channel = opsChannel(env, outsideFetch);
  const base: NotifyOptions & { now: Date } = { now: startedAt, env, ...(channel && { channel }) };

  let runId: bigint | undefined;
  try {
    runId = await startRun({ job: JOB, trigger: options.trigger ?? "schedule" }, startedAt);
    const notify: RunNotify = { ...base, runId };

    const closed = await closeEarlierDates(date, notify);
    const facts = await (options.readFacts ?? readDayFacts)(date);
    for (const warning of facts.warnings) await logEvent(runId, { level: "warn", step: "facts", message: warning });
    const site =
      needsSiteCheck(time, facts) && facts.issue?.slug
        ? await readSiteFacts({ slug: facts.issue.slug, title: facts.issue.title }, { siteUrl, fetch: outsideFetch })
        : null;
    const outcome = evaluateChecks(time, facts, { site, siteUrl, runLink: runLink(runId) });

    let failing: string[] = [];
    if (outcome.status === "skipped") {
      await silenceSkippedDate(date, notify);
      await logEvent(runId, { level: "info", step: "check", message: `${date} is a skipped date. Its checks are off.` });
    } else {
      for (const note of outcome.notes) await logEvent(runId, { level: "info", step: "check", message: note });
      await applyFindings(outcome.findings, { date, time }, notify);
      failing = outcome.findings.flatMap((finding) => (finding.failure ? [finding.incidentKey] : []));
    }
    const resent = await resendOpenCriticals(notify);
    const daily = time === "18:00" ? await sendSummary(facts, { env, fetch: baseFetch, weekday }, notify) : {};
    if (deadline.aborted) {
      await logEvent(runId, {
        level: "warn",
        step: "deadline",
        message: "The run used up its budget for Telegram and site calls. Any call after that was cut off; unsent alerts are retried at the next check time.",
      });
    }

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
    await reportFailure(error, { time, date, runId }, runId === undefined ? base : { ...base, runId });
    if (runId !== undefined) {
      await finishRun(runId, { status: "failed", error: errorText(error) }, now()).catch(() => undefined);
    }
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
