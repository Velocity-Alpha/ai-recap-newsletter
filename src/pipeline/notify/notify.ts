import type { Alert, Prisma } from "@/src/generated/prisma";
import {
  listInfoAlertsSince,
  listOpenAlerts,
  listOpenCriticalsNotSentSince,
  markAlertNotified,
  raiseAlert,
  resolveAlert,
  type AlertSeverity,
} from "@/src/pipeline/alerts";
import { opsChannelFromEnv, type AlertChannel } from "@/src/pipeline/notify/channel";
import { adminLink, buildAlertText, buildResolvedText } from "@/src/pipeline/notify/message";
import { logEvent, type EventLevel } from "@/src/pipeline/runs";

export type Delivery = "sent" | "recorded" | "failed" | "not_configured";

export interface NotifyOptions {
  /** Defaults to the current time. */
  now?: Date;
  /** The caller's run. Alert texts and delivery results go into its pipeline_events. */
  runId?: bigint;
  /** Defaults to process.env. Only `APP_ENV === "production"` sends. */
  env?: Record<string, string | undefined>;
  /** Replaces the channel built from env (tests). */
  channel?: AlertChannel;
}

export interface IncidentInput {
  /** Stable key for one ongoing problem, e.g. `stories-missing:2026-11-09` or `source-empty:tldr:2026-11-09`. */
  incidentKey: string;
  severity: AlertSeverity;
  /** What failed, in one line. Stored as the alert message. */
  what: string;
  evidence: string;
  /** The run or admin page to look at: runLink(id) or adminLink(path). */
  link: string;
  /** Extra JSON for the admin pages and the daily summary. */
  details?: Prisma.InputJsonValue;
}

export type RaiseIncidentResult = { opened: boolean; alertId: bigint; delivery: Delivery | "skipped" };
export type ResolveIncidentResult = { resolved: boolean; delivery: Delivery | "skipped" };

const STEP = "alert";
const HOUR_MS = 60 * 60_000;

async function record(options: NotifyOptions, level: EventLevel, message: string, text: string) {
  if (options.runId !== undefined) {
    await logEvent(options.runId, { level, step: STEP, message, data: { text } });
    return;
  }
  const log = level === "warn" || level === "error" ? console.warn : console.info;
  log(JSON.stringify({ step: STEP, level, message, text }));
}

/**
 * Posts text to the ops chat in production. Elsewhere it only records the text. Never throws for a failed
 * send: the result says what happened, and the run log has the reason.
 */
export async function postToOpsChat(text: string, options: NotifyOptions = {}): Promise<Delivery> {
  const env = options.env ?? process.env;
  if (env.APP_ENV !== "production") {
    await record(options, "info", "Not sent outside production. Recorded the text.", text);
    return "recorded";
  }

  let channel = options.channel;
  if (!channel) {
    const configured = opsChannelFromEnv(env);
    if (!configured.ok) {
      await record(options, "warn", `${configured.reason} Not sent.`, text);
      return "not_configured";
    }
    channel = configured.channel;
  }

  try {
    await channel.send(text);
    await record(options, "info", `Sent to the ops chat (${channel.name}).`, text);
    return "sent";
  } catch (error) {
    await record(options, "warn", `Not sent: ${error instanceof Error ? error.message : String(error)}`, text);
    return "failed";
  }
}

/** The owner counts as told once the text is sent, or recorded outside production. */
function told(delivery: Delivery): boolean {
  return delivery === "sent" || delivery === "recorded";
}

function shouldSendOnRaise(alert: Alert, previousSeverity: AlertSeverity | null): boolean {
  if (alert.severity === "info") return false;
  // Never told yet: a new incident, an info that became a warning, or a send that failed.
  if (alert.notifiedAt === null) return true;
  if (alert.severity === "warning") return false;
  // An open critical repeats only at check times (resendOpenCriticals), unless it just escalated.
  return previousSeverity !== null && previousSeverity !== "critical";
}

function storedContext(alert: Alert): { evidence: string; link: string } {
  const context = (alert.context ?? {}) as { evidence?: unknown; link?: unknown };
  return {
    evidence: typeof context.evidence === "string" ? context.evidence : "None recorded.",
    link: typeof context.link === "string" ? context.link : adminLink(),
  };
}

function alertTextInput(alert: Alert) {
  return {
    incidentKey: alert.incidentKey,
    severity: alert.severity as AlertSeverity,
    what: alert.message,
    ...storedContext(alert),
  };
}

/**
 * Opens or refreshes the incident, then alerts by severity: critical at once (and again on escalation),
 * warning once per incident, info never.
 */
export async function raiseIncident(input: IncidentInput, options: NotifyOptions = {}): Promise<RaiseIncidentResult> {
  const now = options.now ?? new Date();
  const context: Prisma.InputJsonObject = {
    evidence: input.evidence,
    link: input.link,
    ...(input.details === undefined ? {} : { details: input.details }),
  };
  const { opened, alert, previousSeverity } = await raiseAlert(
    { incidentKey: input.incidentKey, severity: input.severity, message: input.what, context },
    now,
  );
  if (!shouldSendOnRaise(alert, previousSeverity)) return { opened, alertId: alert.id, delivery: "skipped" };

  const delivery = await postToOpsChat(buildAlertText(alertTextInput(alert)), { ...options, now });
  if (told(delivery)) await markAlertNotified(alert.id, now);
  return { opened, alertId: alert.id, delivery };
}

/**
 * Call once at each check time, after raising and resolving that check's incidents. Re-sends every open
 * critical not sent in the last `minGapMs` (default 1 hour), so one raised in the same run is not sent twice.
 */
export async function resendOpenCriticals(
  options: NotifyOptions & { minGapMs?: number } = {},
): Promise<Array<{ incidentKey: string; delivery: Delivery }>> {
  const now = options.now ?? new Date();
  const due = await listOpenCriticalsNotSentSince(new Date(now.getTime() - (options.minGapMs ?? HOUR_MS)));

  const results: Array<{ incidentKey: string; delivery: Delivery }> = [];
  for (const alert of due) {
    const text = buildAlertText(alertTextInput(alert), { openSince: alert.firstSeen, now });
    const delivery = await postToOpsChat(text, { ...options, now });
    if (told(delivery)) await markAlertNotified(alert.id, now);
    results.push({ incidentKey: alert.incidentKey, delivery });
  }
  return results;
}

/**
 * Closes the open incident when its check passes again, and posts "resolved" if the owner was told about it.
 * `link` defaults to the incident's own link; `note` replaces "The check passes again."
 */
export async function resolveIncident(
  incidentKey: string,
  options: NotifyOptions & { link?: string; note?: string } = {},
): Promise<ResolveIncidentResult> {
  const now = options.now ?? new Date();
  const alert = await resolveAlert(incidentKey, now);
  if (!alert) return { resolved: false, delivery: "skipped" };
  if (alert.severity === "info" || alert.notifiedAt === null) return { resolved: true, delivery: "skipped" };

  const text = buildResolvedText({
    incidentKey,
    what: alert.message,
    link: options.link ?? storedContext(alert).link,
    note: options.note,
    openSince: alert.firstSeen,
    now,
  });
  return { resolved: true, delivery: await postToOpsChat(text, { ...options, now }) };
}

/** Info incidents seen since `since`, open or resolved, for the daily summary. */
export function listInfoIncidents(since: Date): Promise<Alert[]> {
  return listInfoAlertsSince(since);
}

/** All open incidents, oldest first, for the daily summary. */
export function listOpenIncidents(): Promise<Alert[]> {
  return listOpenAlerts();
}
