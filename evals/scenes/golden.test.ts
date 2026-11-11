import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hashInput, loadGolden, type Golden } from "@/evals/lib/golden";
import { readSceneGolden, SCENE_GOLDEN_PATH, sceneGoldenFor, type SceneGolden } from "@/evals/scenes/golden";
import { readSceneIssues, type SceneIssue } from "@/evals/scenes/issues";
import { SCENE_CONTEXT_FOCUS, SCENE_PROMPT_COMPOSITION, SCENE_REQUIREMENT_RULES } from "@/src/pipeline/draft/image/scene-prompt";

const ISSUE: SceneIssue = {
  issueId: 1,
  date: "2026-01-05",
  context: {
    subjectLine: "Example Labs Ships a Tiny Robot",
    topStories: [
      { headline: "Example Labs Ships a Tiny Robot", detail: "A synthetic story detail." },
      { headline: "Sample Corp Opens a Research Lab", detail: "Another synthetic detail." },
    ],
  },
};

const VALUE: SceneGolden = { lead_story: 1, identifiers: ["Example Labs", "tiny robot"] };

function goldenOf(entries: Golden<SceneGolden>["entries"]): Golden<SceneGolden> {
  return { about: "fake scene golden values", producer: "claude-opus-5-5", entries };
}

const entry = (value: SceneGolden, input: unknown = ISSUE.context) => ({ inputHash: hashInput(input), date: "2026-11-11", value });

describe("sceneGoldenFor", () => {
  it("gives the golden value of an issue, keyed by its date and hashed over its context", () => {
    expect(sceneGoldenFor(goldenOf({ "2026-01-05": entry(VALUE) }), ISSUE)).toEqual(VALUE);
  });

  it("refuses a value made for another version of the issue", () => {
    const stale = entry(VALUE, { ...ISSUE.context, subjectLine: "Older subject" });
    expect(() => sceneGoldenFor(goldenOf({ "2026-01-05": stale }), ISSUE)).toThrow(/changed since/);
  });

  it("refuses a lead that is not one of the top stories", () => {
    expect(() => sceneGoldenFor(goldenOf({ "2026-01-05": entry({ ...VALUE, lead_story: 3 }) }), ISSUE)).toThrow(/not a top story/);
  });

  it("refuses no identifiers, or more than 4", () => {
    expect(() => sceneGoldenFor(goldenOf({ "2026-01-05": entry({ ...VALUE, identifiers: [] }) }), ISSUE)).toThrow(/1 to 4/);
    const five = ["a", "b", "c", "d", "e"];
    expect(() => sceneGoldenFor(goldenOf({ "2026-01-05": entry({ ...VALUE, identifiers: five }) }), ISSUE)).toThrow(/1 to 4/);
  });
});

describe("readSceneGolden", () => {
  const write = (golden: Golden<SceneGolden>) => {
    const path = join(mkdtempSync(join(tmpdir(), "scene-golden-")), "golden.json");
    writeFileSync(path, JSON.stringify(golden));
    return path;
  };

  it("reads a file with a current value for every issue", () => {
    expect(readSceneGolden([ISSUE], write(goldenOf({ "2026-01-05": entry(VALUE) }))).entries["2026-01-05"].value).toEqual(VALUE);
  });

  it("refuses to start a run while an issue has no golden value", () => {
    expect(() => readSceneGolden([ISSUE], write(goldenOf({})))).toThrow(/no current golden value for 1 issues \(2026-01-05\)/);
  });
});

describe("the committed golden values and their work list", () => {
  it("golden.json loads, and each entry it has is current and well formed", () => {
    const golden = loadGolden<SceneGolden>(SCENE_GOLDEN_PATH);
    const issues = new Map(readSceneIssues().issues.map((issue) => [issue.date, issue]));
    for (const id of Object.keys(golden.entries)) {
      const issue = issues.get(id);
      expect(issue, `golden entry ${id} is not an issue of the test set`).toBeDefined();
      expect(() => sceneGoldenFor(golden, issue!)).not.toThrow();
    }
  });

  it("golden-todo.md quotes the app's rules as the prompts state them today", () => {
    const todo = readFileSync(join("evals", "scenes", "golden-todo.md"), "utf8");
    const rules = [
      SCENE_CONTEXT_FOCUS,
      SCENE_REQUIREMENT_RULES.identifiers,
      SCENE_REQUIREMENT_RULES.logos,
      SCENE_PROMPT_COMPOSITION.logo,
      SCENE_PROMPT_COMPOSITION.noScreens,
    ];
    for (const rule of rules) expect(todo).toContain(`> ${rule}`);
  });
});
