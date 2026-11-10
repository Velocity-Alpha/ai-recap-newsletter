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

function notes(outcome: CheckOutcome): string[] {
  if (outcome.status !== "checked") throw new Error("expected checks to run");
  return outcome.notes;
}

const RUNNING = { id: "41", status: "running", startedAt: new Date("2026-11-10T14:55:00Z") };

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

  it("raises a critical for a missing ingest run and the empty day, and no per-source warnings", () => {
    const outcome = run("10:05", missingRun());
    const found = failures(outcome);

    expect(Object.keys(found).sort()).toEqual(["ingest-run-missing:2026-11-10", "stories-thin:2026-11-10"]);
    expect(found["ingest-run-missing:2026-11-10"]).toMatchObject({ severity: "critical" });
    expect(found["ingest-run-missing:2026-11-10"].evidence).toContain("ingest-stories");
    expect(found["stories-thin:2026-11-10"]).toMatchObject({ severity: "critical" });
    // Not judged at all, so open source incidents are neither raised nor resolved.
    expect(keys(outcome).filter((key) => key.startsWith("source-empty:"))).toEqual([]);
    expect(notes(outcome)).toEqual([expect.stringContaining("per-source checks are left to the critical")]);
  });

  it("leaves the per-source checks to the critical when the run is missing, even with some stories", () => {
    const outcome = run("10:05", thinDay({ ingestRun: null }));
    expect(keys(outcome).filter((key) => key.startsWith("source-empty:"))).toEqual([]);
    expect(failures(outcome)["ingest-run-missing:2026-11-10"]).toBeDefined();
  });

  it("waits for an ingest run still running at 10:05, and judges the stories at 12:00", () => {
    const early = run("10:05", thinDay({ ingestRun: RUNNING }));
    expect(keys(early)).toEqual(["ingest-run-missing:2026-11-10"]);
    expect(failures(early)).toEqual({});
    expect(notes(early)).toEqual([
      "Ingest run 41 is still running at 10:05, so the story total and per-source checks wait until 12:00.",
    ]);

    const noon = failures(run("12:00", thinDay({ ingestRun: RUNNING })));
    expect(noon["stories-thin:2026-11-10"]).toBeDefined();
    expect(noon["source-empty:alphasignal:2026-11-10"]).toBeDefined();
  });

  it("raises a critical for a day without stories even without history", () => {
    const found = failures(run("10:05", missingRun({ ingestRun: normalDay().ingestRun, weekdayTotals: [] })));
    expect(found["stories-thin:2026-11-10"]).toMatchObject({ severity: "critical", what: "No stories today." });
    expect(found["stories-thin:2026-11-10"].evidence).toContain("no Tuesday history yet");
  });

  it("skips the thin check without any history for that weekday", () => {
    expect(failures(run("10:05", thinDay({ weekdayTotals: [] })))["stories-thin:2026-11-10"]).toBeUndefined();
  });

  it("warns only about empty sources that are expected on this weekday", () => {
    // Tuesday: AI Breakfast (no reliable day) and The Signal (Mondays) are not expected.
    const found = failures(run("10:05", normalDay({ storiesBySource: { tldr: 5 } })));
    const warned = Object.keys(found).filter((key) => key.startsWith("source-empty:"));
    expect(warned.sort()).toEqual(
      ["alphasignal", "huggingface", "product_hunt_ai", "rundown_ai"].map((key) => `source-empty:${key}:2026-11-10`),
    );
  });

  it("does not expect TLDR on a Monday, but does expect The Signal", () => {
    const found = failures(run("10:05", monday({ storiesBySource: { ...monday().storiesBySource, tldr: 0, the_signal: 0 } })));
    expect(found["source-empty:tldr:2026-11-09"]).toBeUndefined();
    expect(found["source-empty:the_signal:2026-11-09"]).toMatchObject({ what: "No stories from The Signal today." });
  });

  it("names the weekdays a source is expected on in the evidence", () => {
    const found = failures(run("10:05", thinDay()));
    expect(found["source-empty:alphasignal:2026-11-10"].evidence).toContain(
      "AlphaSignal stories usually arrive on Monday, Tuesday, Wednesday, Thursday and Friday.",
    );
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
