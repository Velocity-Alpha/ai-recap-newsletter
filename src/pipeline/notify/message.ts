import type { AlertSeverity } from "@/src/pipeline/alerts";

/** Plain-text alert messages. Each names what failed, the evidence, and a link. */

const SITE_URL = "https://airecap.news";

/** A link to an admin page, e.g. adminLink("/incidents"). The pages live under /admin (#54). */
export function adminLink(path = ""): string {
  if (!path) return `${SITE_URL}/admin`;
  return `${SITE_URL}/admin${path.startsWith("/") ? path : `/${path}`}`;
}

/** A link to one run's page in the admin. */
export function runLink(runId: bigint | number | string): string {
  return adminLink(`/runs/${runId.toString()}`);
}

export type AlertTextInput = {
  incidentKey: string;
  severity: AlertSeverity;
  what: string;
  evidence: string;
  link: string;
};

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under 1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The alert text. Pass `repeat` for a critical that is still open at a later check time. */
export function buildAlertText(input: AlertTextInput, repeat?: { openSince: Date; now: Date }): string {
  const label = input.severity.toUpperCase();
  const heading = repeat
    ? `${label}, still open after ${formatDuration(repeat.now.getTime() - repeat.openSince.getTime())}`
    : label;
  return [
    `${heading}: ${input.what}`,
    `Evidence: ${input.evidence}`,
    `Link: ${input.link}`,
    `Incident: ${input.incidentKey}`,
  ].join("\n");
}

export function buildResolvedText(input: {
  incidentKey: string;
  what: string;
  link: string;
  note?: string;
  openSince: Date;
  now: Date;
}): string {
  return [
    `RESOLVED after ${formatDuration(input.now.getTime() - input.openSince.getTime())}: ${input.what}`,
    input.note ?? "The check passes again.",
    `Link: ${input.link}`,
    `Incident: ${input.incidentKey}`,
  ].join("\n");
}
