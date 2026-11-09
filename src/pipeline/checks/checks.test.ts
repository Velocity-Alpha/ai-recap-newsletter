import { describe, expect, it } from "vitest";

import {
  checkIncidentDate,
  evaluateChecks,
  needsSiteCheck,
  type CheckOutcome,
  type SiteFacts,
} from "@/src/pipeline/checks/checks";
import {
  committedNoDraft,
  draftNotPublished,
  missingRun,
  monday,
  normalDay,
  notCommitted,
  skippedDate,
  thinDay,
} from "@/src/pipeline/checks/day-facts.fixture";
import type { DayFacts } from "@/src/pipeline/checks/day-facts";
import type { CheckTime } from "@/src/pipeline/checks/schedule";

const SITE = "https://airecap.news";
const RUN_LINK = "https://airecap.news/admin/runs/9";

const SITE_OK: SiteFacts = {
  issueUrl: `${SITE}/issue/synthetic-model-ships`,
  issuePage: { status: 200, hasTitle: true },
  homeUrl: `${SITE}/`,
  home: { status: 200, listsIssue: true },
};

function run(time: CheckTime, facts: DayFacts, site: SiteFacts | null = null): CheckOutcome {
  return evaluateChecks(time, facts, { site, siteUrl: SITE, runLink: RUN_LINK });
}

function failures(outcome: CheckOutcome) {
  if (outcome.status !== "checked") throw new Error("expected checks to run");
  return Object.fromEntries(
    outcome.findings.flatMap((finding) => (finding.failure ? [[finding.incidentKey, finding.failure]] : [])),
  );
}

function keys(outcome: CheckOutcome): string[] {
  if (outcome.status !== "checked") throw new Error("expected checks to run");
  return outcome.findings.map((finding) => finding.incidentKey);
}

const SOURCE_KEYS = ["rundown_ai", "ai_breakfast", "the_signal", "tldr", "alphasignal", "product_hunt_ai", "huggingface"];

describe("10:05 stories check", () => {
  it("passes on a normal day, and checks only the stories", () => {
    const outcome = run("10:05", normalDay());

    expect(failures(outcome)).toEqual({});
    expect(keys(outcome)).toEqual([
      "ingest-run-missing:2026-11-10",
      "stories-thin:2026-11-10",
      ...SOURCE_KEYS.map((key) => `source-empty:${key}:2026-11-10`),
    ]);
  });

  it("judges a Monday against earlier Mondays, not the other weekdays", () => {
    // 35 stories is under half the Tuesday median (81) but well over half the Monday median (43).
    expect(failures(run("10:05", monday()))).toEqual({});
    expect(Object.keys(failures(run("10:05", normalDay({ storiesBySource: monday().storiesBySource })))))
      .toContain("stories-thin:2026-11-10");
  });

  it("raises a critical on a thin day, and a warning naming each empty source", () => {
    const found = failures(run("10:05", thinDay()));

    expect(Object.keys(found).sort()).toEqual(["source-empty:alphasignal:2026-11-10", "stories-thin:2026-11-10"]);
    expect(found["stories-thin:2026-11-10"]).toMatchObject({ severity: "critical", link: RUN_LINK });
    expect(found["stories-thin:2026-11-10"].evidence).toContain("30 stories");
    expect(found["stories-thin:2026-11-10"].evidence).toContain("Tuesday median is 81");
    expect(found["source-empty:alphasignal:2026-11-10"]).toMatchObject({
      severity: "warning",
      what: "No stories from AlphaSignal today.",
    });
  });

  it("raises a critical for a missing ingest run, plus the empty day", () => {
    const found = failures(run("10:05", missingRun()));

    expect(found["ingest-run-missing:2026-11-10"]).toMatchObject({ severity: "critical" });
    expect(found["ingest-run-missing:2026-11-10"].evidence).toContain("ingest-stories");
    expect(found["stories-thin:2026-11-10"]).toMatchObject({ severity: "critical" });
    for (const key of SOURCE_KEYS) expect(found[`source-empty:${key}:2026-11-10`]).toMatchObject({ severity: "warning" });
  });

  it("does not look for an ingest run while n8n owns ingestion", () => {
    const found = failures(run("10:05", missingRun({ ingestOwner: "n8n" })));
    expect(found["ingest-run-missing:2026-11-10"]).toBeUndefined();
    expect(found["stories-thin:2026-11-10"]).toBeDefined();
  });

  it("skips the thin check without any history for that weekday", () => {
    expect(failures(run("10:05", thinDay({ weekdayTotals: [] })))["stories-thin:2026-11-10"]).toBeUndefined();
  });

  it("does not warn about a source that seldom sends on this weekday", () => {
    // AlphaSignal had stories on only 3 of the last 8 Tuesdays.
    const found = failures(run("10:05", thinDay({ sourceWeekdays: { ...thinDay().sourceWeekdays, alphasignal: 3 } })));
    expect(found["source-empty:alphasignal:2026-11-10"]).toBeUndefined();
    // On half of them or more, it is expected.
    const usual = failures(run("10:05", thinDay({ sourceWeekdays: { ...thinDay().sourceWeekdays, alphasignal: 4 } })));
    expect(usual["source-empty:alphasignal:2026-11-10"]).toBeDefined();
  });

  it("warns about every empty source without any history", () => {
    const found = failures(run("10:05", missingRun({ weekdayTotals: [], sourceWeekdays: {} })));
    for (const key of SOURCE_KEYS) expect(found[`source-empty:${key}:2026-11-10`]).toBeDefined();
  });
});

describe("skipped date", () => {
  it("silences every check of that date", () => {
    for (const time of ["10:05", "12:00", "18:00"] as const) {
      expect(run(time, skippedDate(), null)).toEqual({ status: "skipped" });
    }
  });
});

describe("12:00 commit check", () => {
  it("warns when nothing is committed for today", () => {
    const found = failures(run("12:00", notCommitted()));
    expect(found["commit-missing:2026-11-10"]).toMatchObject({
      severity: "warning",
      link: `${SITE}/approval?date=2026-11-10`,
    });
  });

  it("passes once the outline is committed, and still re-checks the stories", () => {
    const outcome = run("12:00", normalDay());
    expect(failures(outcome)).toEqual({});
    expect(keys(outcome)).toContain("commit-missing:2026-11-10");
    expect(keys(outcome)).toContain("stories-thin:2026-11-10");
  });

  it("is not checked at 10:05", () => {
    expect(keys(run("10:05", notCommitted()))).not.toContain("commit-missing:2026-11-10");
  });
});

describe("18:00 draft and publish checks", () => {
  it("raises a critical when committed but no draft is ready", () => {
    const found = failures(run("18:00", committedNoDraft()));
    expect(Object.keys(found)).toEqual(["draft-missing:2026-11-10"]);
    expect(found["draft-missing:2026-11-10"]).toMatchObject({ severity: "critical" });
    expect(found["draft-missing:2026-11-10"].evidence).toContain("23 stories");
  });

  it("warns as a reminder when the draft is ready but not published", () => {
    const found = failures(run("18:00", draftNotPublished()));
    expect(Object.keys(found)).toEqual(["publish-pending:2026-11-10"]);
    expect(found["publish-pending:2026-11-10"]).toMatchObject({ severity: "warning", link: `${SITE}/approval/issues` });
  });

  it("passes when the issue is published and on the site", () => {
    const outcome = run("18:00", normalDay(), SITE_OK);
    expect(failures(outcome)).toEqual({});
    expect(keys(outcome)).toEqual(
      expect.arrayContaining(["draft-missing:2026-11-10", "publish-pending:2026-11-10", "site-check-failed:2026-11-10"]),
    );
  });

  it("raises a critical when the issue page is missing", () => {
    const found = failures(run("18:00", normalDay(), { ...SITE_OK, issuePage: { status: 404, hasTitle: false } }));
    expect(found["site-check-failed:2026-11-10"]).toMatchObject({ severity: "critical", link: SITE_OK.issueUrl });
    expect(found["site-check-failed:2026-11-10"].evidence).toContain("HTTP 404");
  });

  it("raises a critical when the issue page lacks the title", () => {
    const found = failures(run("18:00", normalDay(), { ...SITE_OK, issuePage: { status: 200, hasTitle: false } }));
    expect(found["site-check-failed:2026-11-10"].evidence).toContain("does not contain the title");
  });

  it("raises a critical when the home page does not list the issue", () => {
    const found = failures(run("18:00", normalDay(), { ...SITE_OK, home: { status: 200, listsIssue: false } }));
    expect(found["site-check-failed:2026-11-10"].evidence).toContain("home page does not list /issue/synthetic-model-ships");
  });

  it("raises a critical when the site could not be read", () => {
    const found = failures(
      run("18:00", normalDay(), { ...SITE_OK, issuePage: { status: null, hasTitle: false, error: "timeout" } }),
    );
    expect(found["site-check-failed:2026-11-10"].evidence).toContain("timeout");
  });

  it("keeps only the commit warning when nothing was committed by 18:00", () => {
    expect(Object.keys(failures(run("18:00", notCommitted())))).toEqual(["commit-missing:2026-11-10"]);
  });

  it("checks the site only at 18:00 for a published issue", () => {
    expect(needsSiteCheck("18:00", normalDay())).toBe(true);
    expect(needsSiteCheck("12:00", normalDay())).toBe(false);
    expect(needsSiteCheck("18:00", draftNotPublished())).toBe(false);
    expect(needsSiteCheck("18:00", skippedDate())).toBe(false);
  });
});

describe("checkIncidentDate", () => {
  it("reads the date of a check incident key, and ignores other keys", () => {
    expect(checkIncidentDate("source-empty:tldr:2026-11-10")).toBe("2026-11-10");
    expect(checkIncidentDate("stories-thin:2026-11-09")).toBe("2026-11-09");
    expect(checkIncidentDate("ingest-failed:2026-11-09")).toBeNull();
    expect(checkIncidentDate("stories-thin")).toBeNull();
  });
});
