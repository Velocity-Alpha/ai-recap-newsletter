import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pickSpread, readSceneIssues } from "@/evals/scenes/issues";

describe("readSceneIssues", () => {
  it("reads the committed test set: 100 issues in date order, one per date, each with a subject line and top stories", () => {
    const { issues } = readSceneIssues();
    expect(issues).toHaveLength(100);
    expect(new Set(issues.map((issue) => issue.date)).size).toBe(100);
    expect(issues.map((issue) => issue.date)).toEqual([...issues.map((issue) => issue.date)].sort());
    for (const issue of issues) {
      expect(issue.context.subjectLine.trim()).not.toBe("");
      expect(issue.context.topStories.length).toBeGreaterThan(0);
    }
  });

  it("refuses a file with no issues", () => {
    const path = join(mkdtempSync(join(tmpdir(), "scene-issues-")), "issues.json");
    writeFileSync(path, JSON.stringify({ note: "", from: "", to: "", issues: [] }));
    expect(() => readSceneIssues(path)).toThrow(/no issues/);
  });
});

describe("pickSpread", () => {
  const days = Array.from({ length: 10 }, (_, index) => index);

  it("keeps every item when there are no more than asked for", () => {
    expect(pickSpread(days, 20)).toEqual(days);
  });

  it("spreads the picks evenly, in order", () => {
    expect(pickSpread(days, 5)).toEqual([0, 2, 4, 6, 8]);
  });

  it("keeps the items it must, then spreads the rest", () => {
    expect(pickSpread(days, 4, (day) => day >= 8)).toEqual([0, 4, 8, 9]);
  });
});
