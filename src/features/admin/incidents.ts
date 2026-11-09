import type { Alert } from "@/src/generated/prisma";
import { adminLink, listOpenIncidents } from "@/src/pipeline/notify";
import { prisma } from "@/src/server/prisma";

/** Incidents (rows of the `alerts` table) for /admin/incidents. */

export const RECENT_RESOLVED = 25;

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export type IncidentRow = {
  id: string;
  key: string;
  severity: string;
  status: string;
  firstSeen: Date;
  lastSeen: Date;
  resolvedAt: Date | null;
  /** The last time the owner was told (sent, or recorded outside production). */
  lastAlertedAt: Date | null;
  message: string;
  evidence: string | null;
  link: string | null;
};

/** Alert links point at production (adminLink). Keep admin links on the deploy the owner is looking at. */
export function adminHref(link: string): string {
  const base = adminLink(); // https://airecap.news/admin
  const isAdminLink = link === base || link.startsWith(`${base}/`) || link.startsWith(`${base}?`);
  return isAdminLink ? link.slice(new URL(base).origin.length) : link;
}

export function toIncidentRow(alert: Alert): IncidentRow {
  // raiseIncident (src/pipeline/notify) stores { evidence, link, details? } as the context.
  const context = (alert.context ?? {}) as { evidence?: unknown; link?: unknown };
  return {
    id: alert.id.toString(),
    key: alert.incidentKey,
    severity: alert.severity,
    status: alert.status,
    firstSeen: alert.firstSeen,
    lastSeen: alert.lastSeen,
    resolvedAt: alert.resolvedAt,
    lastAlertedAt: alert.notifiedAt,
    message: alert.message,
    evidence: typeof context.evidence === "string" ? context.evidence : null,
    link: typeof context.link === "string" ? adminHref(context.link) : null,
  };
}

/** Open incidents (most severe first, then oldest first) and the latest resolved ones. */
export async function listIncidents(): Promise<{ open: IncidentRow[]; resolved: IncidentRow[] }> {
  const [open, resolved] = await Promise.all([
    listOpenIncidents(),
    prisma.alert.findMany({ where: { status: "resolved" }, orderBy: { resolvedAt: "desc" }, take: RECENT_RESOLVED }),
  ]);
  const bySeverity = [...open].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
  return { open: bySeverity.map(toIncidentRow), resolved: resolved.map(toIncidentRow) };
}
