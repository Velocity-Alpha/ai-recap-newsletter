import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ alert: { findMany: vi.fn() } }));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import { adminHref, listIncidents, RECENT_RESOLVED, toIncidentRow } from "@/src/features/admin/incidents";
import { runLink } from "@/src/pipeline/notify";

const FIRST = new Date("2026-11-09T15:05:00Z");
const LAST = new Date("2026-11-09T17:00:00Z");

function alert(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id: BigInt(id),
    incidentKey: `stories-missing:2026-11-${id}`,
    openIncidentKey: `stories-missing:2026-11-${id}`,
    severity: "critical",
    status: "open",
    firstSeen: FIRST,
    lastSeen: LAST,
    notifiedAt: LAST,
    resolvedAt: null,
    message: "No stories for today",
    context: { evidence: "0 stories by 10:05", link: runLink(12) },
    ...overrides,
  };
}

describe("adminHref", () => {
  it("turns a production admin link into a path, so it works on any deploy", () => {
    expect(adminHref("https://airecap.news/admin/runs/12")).toBe("/admin/runs/12");
    expect(adminHref("https://airecap.news/admin")).toBe("/admin");
  });

  it("keeps any other link as it is", () => {
    expect(adminHref("https://airecap.news/approval")).toBe("https://airecap.news/approval");
    expect(adminHref("https://airecap.news/administrator")).toBe("https://airecap.news/administrator");
  });
});

describe("toIncidentRow", () => {
  it("maps the alert with its evidence and link from the stored context", () => {
    expect(toIncidentRow(alert(9))).toEqual({
      id: "9",
      key: "stories-missing:2026-11-9",
      severity: "critical",
      status: "open",
      firstSeen: FIRST,
      lastSeen: LAST,
      resolvedAt: null,
      lastAlertedAt: LAST,
      message: "No stories for today",
      evidence: "0 stories by 10:05",
      link: "/admin/runs/12",
    });
  });

  it("copes with an alert raised without context", () => {
    expect(toIncidentRow(alert(9, { context: null }))).toMatchObject({ evidence: null, link: null });
    expect(toIncidentRow(alert(9, { context: { evidence: 3 } }))).toMatchObject({ evidence: null, link: null });
  });
});

describe("listIncidents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists open incidents, critical first, and the latest resolved ones", async () => {
    prismaMock.alert.findMany.mockImplementation(async (args: { where: { status: string } }) =>
      args.where.status === "open"
        ? [alert(1, { severity: "info" }), alert(2, { severity: "warning" }), alert(3)]
        : [alert(4, { status: "resolved", openIncidentKey: null, resolvedAt: LAST })],
    );

    const incidents = await listIncidents();

    expect(prismaMock.alert.findMany).toHaveBeenCalledWith({
      where: { status: "open" },
      orderBy: { firstSeen: "asc" },
    });
    expect(prismaMock.alert.findMany).toHaveBeenCalledWith({
      where: { status: "resolved" },
      orderBy: { resolvedAt: "desc" },
      take: RECENT_RESOLVED,
    });
    expect(incidents.open.map((row) => [row.id, row.severity])).toEqual([
      ["3", "critical"],
      ["2", "warning"],
      ["1", "info"],
    ]);
    expect(incidents.resolved).toEqual([expect.objectContaining({ id: "4", status: "resolved", resolvedAt: LAST })]);
  });
});
