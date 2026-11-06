import type { Prisma } from "@/src/generated/prisma";
import { prisma } from "@/src/server/prisma";

export type AlertSeverity = "critical" | "warning" | "info";

export type RaiseAlertInput = {
  incidentKey: string;
  severity: AlertSeverity;
  message: string;
  context?: Prisma.InputJsonValue;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function refreshOpenAlert(input: RaiseAlertInput, now: Date) {
  return prisma.alert.update({
    where: { openIncidentKey: input.incidentKey },
    data: { severity: input.severity, lastSeen: now, message: input.message, context: input.context },
  });
}

/**
 * Opens an alert for the incident, or refreshes the one already open.
 * `opened` is true only for a new incident, so callers notify once per incident.
 */
export async function raiseAlert(input: RaiseAlertInput, now: Date) {
  // Look first: the usual repeat case then logs no Prisma error.
  const open = await prisma.alert.findUnique({
    where: { openIncidentKey: input.incidentKey },
    select: { id: true },
  });
  if (open) return { opened: false, alert: await refreshOpenAlert(input, now) };

  try {
    const alert = await prisma.alert.create({
      data: {
        incidentKey: input.incidentKey,
        openIncidentKey: input.incidentKey,
        severity: input.severity,
        status: "open",
        firstSeen: now,
        lastSeen: now,
        message: input.message,
        context: input.context,
      },
    });
    return { opened: true, alert };
  } catch (error) {
    // Another run opened the same incident between the lookup and the insert.
    if (!isUniqueViolation(error)) throw error;
    return { opened: false, alert: await refreshOpenAlert(input, now) };
  }
}

/** Resolves the open alert for the incident. Returns null when nothing is open. */
export async function resolveAlert(incidentKey: string, now: Date) {
  const open = await prisma.alert.findUnique({ where: { openIncidentKey: incidentKey }, select: { id: true } });
  if (!open) return null;

  return prisma.alert.update({
    where: { id: open.id },
    data: { status: "resolved", openIncidentKey: null, resolvedAt: now },
  });
}

export function markAlertNotified(id: bigint, now: Date) {
  return prisma.alert.update({ where: { id }, data: { notifiedAt: now } });
}

export function listOpenAlerts() {
  return prisma.alert.findMany({ where: { status: "open" }, orderBy: { firstSeen: "asc" } });
}
