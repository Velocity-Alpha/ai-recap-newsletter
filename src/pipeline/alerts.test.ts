import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  alert: {
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import {
  listInfoAlertsSince,
  listOpenAlerts,
  listOpenCriticalsNotSentSince,
  markAlertNotified,
  raiseAlert,
  resolveAlert,
} from "@/src/pipeline/alerts";

function uniqueViolation() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

const now = new Date("2026-11-06T15:05:00.000Z");
const input = {
  incidentKey: "source-stale:tldr",
  severity: "critical" as const,
  message: "No TLDR stories today",
  context: { count: 0 },
};

describe("raiseAlert", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens a new alert when none is open for the incident", async () => {
    prismaMock.alert.findUnique.mockResolvedValueOnce(null);
    prismaMock.alert.create.mockResolvedValueOnce({ id: 1n, ...input });

    const result = await raiseAlert(input, now);

    expect(prismaMock.alert.create).toHaveBeenCalledWith({
      data: {
        incidentKey: "source-stale:tldr",
        openIncidentKey: "source-stale:tldr",
        severity: "critical",
        status: "open",
        firstSeen: now,
        lastSeen: now,
        message: "No TLDR stories today",
        context: { count: 0 },
      },
    });
    expect(prismaMock.alert.update).not.toHaveBeenCalled();
    expect(result).toEqual({ opened: true, alert: { id: 1n, ...input }, previousSeverity: null });
  });

  it("refreshes the open alert instead of opening a second one", async () => {
    prismaMock.alert.findUnique.mockResolvedValueOnce({ id: 1n, severity: "warning" });
    prismaMock.alert.update.mockResolvedValueOnce({ id: 1n, ...input });

    const result = await raiseAlert(input, now);

    expect(prismaMock.alert.findUnique).toHaveBeenCalledWith({
      where: { openIncidentKey: "source-stale:tldr" },
      select: { id: true, severity: true },
    });
    expect(prismaMock.alert.create).not.toHaveBeenCalled();
    expect(prismaMock.alert.update).toHaveBeenCalledWith({
      where: { openIncidentKey: "source-stale:tldr" },
      data: { severity: "critical", lastSeen: now, message: "No TLDR stories today", context: { count: 0 } },
    });
    expect(result.opened).toBe(false);
    // The caller needs the severity before the refresh to see an escalation (warning -> critical).
    expect(result.previousSeverity).toBe("warning");
  });

  it("falls back to a refresh when another run opened the alert first", async () => {
    prismaMock.alert.findUnique.mockResolvedValueOnce(null);
    prismaMock.alert.create.mockRejectedValueOnce(uniqueViolation());
    prismaMock.alert.update.mockResolvedValueOnce({ id: 1n, ...input });

    const result = await raiseAlert(input, now);

    expect(prismaMock.alert.update).toHaveBeenCalledTimes(1);
    expect(result.opened).toBe(false);
    expect(result.previousSeverity).toBeNull();
  });

  it("rethrows any other database error", async () => {
    prismaMock.alert.findUnique.mockResolvedValueOnce(null);
    prismaMock.alert.create.mockRejectedValueOnce(new Error("connection lost"));

    await expect(raiseAlert(input, now)).rejects.toThrow("connection lost");
  });
});

describe("resolveAlert", () => {
  beforeEach(() => vi.clearAllMocks());

  it("closes the open alert and frees its incident key", async () => {
    prismaMock.alert.findUnique.mockResolvedValueOnce({ id: 1n });
    prismaMock.alert.update.mockResolvedValueOnce({ id: 1n, status: "resolved" });

    await expect(resolveAlert("source-stale:tldr", now)).resolves.toEqual({ id: 1n, status: "resolved" });
    expect(prismaMock.alert.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { status: "resolved", openIncidentKey: null, resolvedAt: now },
    });
  });

  it("returns null when nothing is open for the incident", async () => {
    prismaMock.alert.findUnique.mockResolvedValueOnce(null);

    await expect(resolveAlert("source-stale:tldr", now)).resolves.toBeNull();
    expect(prismaMock.alert.update).not.toHaveBeenCalled();
  });
});

describe("markAlertNotified", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stamps notified_at", async () => {
    prismaMock.alert.update.mockResolvedValueOnce({ id: 7n });

    await markAlertNotified(7n, now);

    expect(prismaMock.alert.update).toHaveBeenCalledWith({ where: { id: 7n }, data: { notifiedAt: now } });
  });
});

describe("listOpenAlerts", () => {
  it("lists open alerts, oldest first", async () => {
    prismaMock.alert.findMany.mockResolvedValueOnce([]);

    await listOpenAlerts();

    expect(prismaMock.alert.findMany).toHaveBeenCalledWith({
      where: { status: "open" },
      orderBy: { firstSeen: "asc" },
    });
  });
});

describe("listOpenCriticalsNotSentSince", () => {
  it("lists open critical alerts never sent, or last sent before the cutoff", async () => {
    prismaMock.alert.findMany.mockResolvedValueOnce([]);

    await listOpenCriticalsNotSentSince(now);

    expect(prismaMock.alert.findMany).toHaveBeenCalledWith({
      where: { status: "open", severity: "critical", OR: [{ notifiedAt: null }, { notifiedAt: { lt: now } }] },
      orderBy: { firstSeen: "asc" },
    });
  });
});

describe("listInfoAlertsSince", () => {
  it("lists info alerts seen since the given time, open or resolved, oldest first", async () => {
    prismaMock.alert.findMany.mockResolvedValueOnce([]);

    await listInfoAlertsSince(now);

    expect(prismaMock.alert.findMany).toHaveBeenCalledWith({
      where: { severity: "info", lastSeen: { gte: now } },
      orderBy: { firstSeen: "asc" },
    });
  });
});
