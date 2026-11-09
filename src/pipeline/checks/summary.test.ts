import { describe, expect, it } from "vitest";

import { committedNoDraft, missingRun, normalDay, skippedDate } from "@/src/pipeline/checks/day-facts.fixture";
import { buildDailySummary, type SummaryIncident } from "@/src/pipeline/checks/summary";

const THIN: SummaryIncident = {
  incidentKey: "stories-thin:2026-11-10",
  severity: "critical",
  message: "Only 30 stories today, under half the usual Tuesday.",
  firstSeen: new Date("2026-11-10T15:05:00Z"),
};
const INFO: SummaryIncident = {
  incidentKey: "paywall-unknown:2026-11-10",
  severity: "info",
  message: "Paywall check timed out for 2 stories.",
  firstSeen: new Date("2026-11-10T15:00:00Z"),
};

describe("buildDailySummary", () => {
  it("lists stories per source, commit time, drafts, publish time and incidents", () => {
    const text = buildDailySummary({ facts: normalDay(), openIncidents: [THIN], infoIncidents: [INFO] });

    expect(text).toBe(
      [
        "Daily summary: Tuesday 2026-11-10",
        "",
        "Stories: 81 (8-week Tuesday median 81). Ingest run 41: succeeded.",
        "- The Rundown: 14",
        "- AI Breakfast: 12",
        "- The Signal: 10",
        "- TLDR: 16",
        "- AlphaSignal: 9",
        "- Product Hunt: 10",
        "- Hugging Face: 10",
        "Commit: about 11:42 (23 stories queued).",
        "Drafts: 1 made, ready.",
        'Published: 12:31, "Synthetic Model Ships & Agents Learn".',
        "",
        "Open incidents (1):",
        "- CRITICAL stories-thin:2026-11-10: Only 30 stories today, under half the usual Tuesday.",
        "Info incidents (1):",
        "- paywall-unknown:2026-11-10: Paywall check timed out for 2 stories.",
        "",
        "Times are New York.",
      ].join("\n"),
    );
  });

  it("says what is missing on a bad day, and lists other sources too", () => {
    const text = buildDailySummary({
      facts: missingRun({ storiesBySource: { aloa: 2 } }),
      openIncidents: [],
      infoIncidents: [],
    });

    expect(text).toContain("Stories: 2 (8-week Tuesday median 81). No ingest run today.");
    expect(text).toContain("- TLDR: 0");
    expect(text).toContain("- aloa: 2");
    expect(text).toContain("Commit: none.");
    expect(text).toContain("Drafts: none.");
    expect(text).toContain("Published: no.");
    expect(text).toContain("Open incidents: none.");
    expect(text).not.toContain("Info incidents");
  });

  it("shows a draft that is not ready", () => {
    expect(buildDailySummary({ facts: committedNoDraft(), openIncidents: [], infoIncidents: [] })).toContain(
      "Drafts: 1 made, none ready.",
    );
  });

  it("goes out on a skipped date too, and says so", () => {
    const text = buildDailySummary({
      facts: skippedDate({ skipped: { note: "Holiday", createdAt: new Date("2026-11-10T13:00:00Z") } }),
      openIncidents: [],
      infoIncidents: [],
    });

    expect(text.split("\n").slice(0, 2)).toEqual(["Daily summary: Tuesday 2026-11-10", "Skipped date: no issue today (Holiday). Checks are off."]);
  });
});
