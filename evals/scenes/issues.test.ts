import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readSceneIssues } from "@/evals/scenes/issues";

describe("readSceneIssues", () => {
  it("reads the committed test set: 10 issues in date order, each with a subject line and top stories", () => {
    const { issues } = readSceneIssues();
    expect(issues).toHaveLength(10);
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
