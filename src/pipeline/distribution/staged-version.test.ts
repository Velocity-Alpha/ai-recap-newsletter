import { describe, expect, it } from "vitest";

import {
  draftChangedSinceStaged,
  STAGE_INCIDENT_PREFIX,
  stagedEmailName,
  stageIncidentKey,
  type StagedComparison,
} from "@/src/pipeline/distribution/staged-version";

const STAGED: StagedComparison = { draftId: 41, title: "Pretend Lab Plans A Week", featuredImageUrl: "https://assets.example.test/a.jpg" };

describe("draftChangedSinceStaged", () => {
  it("is false when the draft row, the title, and the image are the same", () => {
    expect(draftChangedSinceStaged({ ...STAGED }, STAGED)).toBe(false);
  });

  it("is true for a different draft row", () => {
    expect(draftChangedSinceStaged({ ...STAGED, draftId: 42 }, STAGED)).toBe(true);
  });

  it("is true for a different title", () => {
    expect(draftChangedSinceStaged({ ...STAGED, title: "Pretend Lab Plans A Month" }, STAGED)).toBe(true);
  });

  it("is true for a different image URL", () => {
    expect(draftChangedSinceStaged({ ...STAGED, featuredImageUrl: "https://assets.example.test/b.jpg" }, STAGED)).toBe(true);
  });

  it("treats a missing image and an empty image URL as the same", () => {
    expect(draftChangedSinceStaged({ ...STAGED, featuredImageUrl: null }, { ...STAGED, featuredImageUrl: "" })).toBe(false);
  });
});

describe("stagedEmailName", () => {
  const INPUT = { issueDate: "2026-11-09", version: 2, title: "Synthetic subject line" };

  it("is the date, the version, and the title", () => {
    expect(stagedEmailName(INPUT)).toBe("2026-11-09 v2: Synthetic subject line");
  });

  it("trims the title and folds line breaks", () => {
    expect(stagedEmailName({ ...INPUT, version: 1, title: "  A long\n title  " })).toBe("2026-11-09 v1: A long title");
  });

  it("refuses a date that is not YYYY-MM-DD", () => {
    expect(() => stagedEmailName({ ...INPUT, issueDate: "2026-11-9" })).toThrow(/YYYY-MM-DD/);
  });

  it("refuses a version that is not a whole number from 1", () => {
    expect(() => stagedEmailName({ ...INPUT, version: 0 })).toThrow(/whole number/);
    expect(() => stagedEmailName({ ...INPUT, version: 1.5 })).toThrow(/whole number/);
  });

  it("refuses an empty title", () => {
    expect(() => stagedEmailName({ ...INPUT, title: "   " })).toThrow("The title is empty.");
  });
});

describe("stageIncidentKey", () => {
  it("is the prefix and the issue date", () => {
    expect(stageIncidentKey("2026-11-09")).toBe("stage.failed:2026-11-09");
    expect(stageIncidentKey("2026-11-09").startsWith(`${STAGE_INCIDENT_PREFIX}:`)).toBe(true);
  });
});
