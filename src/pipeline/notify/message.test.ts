import { describe, expect, it } from "vitest";

import { adminLink, buildAlertText, buildResolvedText, formatDuration, runLink } from "@/src/pipeline/notify/message";

const incident = {
  incidentKey: "stories-missing:2026-11-09",
  severity: "critical" as const,
  what: "No ingest run today",
  evidence: "No ingest-stories run since 00:00 New York time.",
  link: "https://airecap.news/admin/runs/42",
};

describe("links", () => {
  it("builds a run link", () => {
    expect(runLink(42n)).toBe("https://airecap.news/admin/runs/42");
    expect(runLink("7")).toBe("https://airecap.news/admin/runs/7");
  });

  it("builds an admin page link", () => {
    expect(adminLink()).toBe("https://airecap.news/admin");
    expect(adminLink("/incidents")).toBe("https://airecap.news/admin/incidents");
    expect(adminLink("settings")).toBe("https://airecap.news/admin/settings");
  });
});

describe("buildAlertText", () => {
  it("names what failed, the evidence, the link, and the incident key", () => {
    expect(buildAlertText(incident)).toBe(
      [
        "CRITICAL: No ingest run today",
        "Evidence: No ingest-stories run since 00:00 New York time.",
        "Link: https://airecap.news/admin/runs/42",
        "Incident: stories-missing:2026-11-09",
      ].join("\n"),
    );
  });

  it("labels a warning", () => {
    expect(buildAlertText({ ...incident, severity: "warning" })).toMatch(/^WARNING: No ingest run today\n/);
  });

  it("says how long a repeated critical has been open", () => {
    const text = buildAlertText(incident, {
      openSince: new Date("2026-11-09T15:05:00Z"),
      now: new Date("2026-11-09T17:00:00Z"),
    });
    expect(text).toMatch(/^CRITICAL, still open after 1h 55m: No ingest run today\n/);
    expect(text).toContain("Link: https://airecap.news/admin/runs/42");
  });
});

describe("buildResolvedText", () => {
  it("says the check passes again and how long the incident was open", () => {
    expect(
      buildResolvedText({
        incidentKey: incident.incidentKey,
        what: incident.what,
        link: "https://airecap.news/admin/runs/43",
        openSince: new Date("2026-11-09T15:05:00Z"),
        now: new Date("2026-11-09T16:00:00Z"),
      }),
    ).toBe(
      [
        "RESOLVED after 55m: No ingest run today",
        "The check passes again.",
        "Link: https://airecap.news/admin/runs/43",
        "Incident: stories-missing:2026-11-09",
      ].join("\n"),
    );
  });

  it("uses the caller's note when given", () => {
    const text = buildResolvedText({
      incidentKey: incident.incidentKey,
      what: incident.what,
      link: incident.link,
      note: "42 stories are in.",
      openSince: new Date("2026-11-09T15:05:00Z"),
      now: new Date("2026-11-09T16:00:00Z"),
    });
    expect(text.split("\n")[1]).toBe("42 stories are in.");
  });
});

describe("formatDuration", () => {
  it("formats minutes, hours, and days", () => {
    expect(formatDuration(20_000)).toBe("under 1m");
    expect(formatDuration(55 * 60_000)).toBe("55m");
    expect(formatDuration(2 * 3_600_000)).toBe("2h 0m");
    expect(formatDuration(27 * 3_600_000 + 5 * 60_000)).toBe("1d 3h");
  });
});
