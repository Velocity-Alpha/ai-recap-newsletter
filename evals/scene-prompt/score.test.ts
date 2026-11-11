import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import type { Outcome } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";
import { sceneIssueFrom } from "@/evals/scene-prompt/issues";
import {
  checkScenePrompt,
  checkSceneText,
  passesScenePromptRules,
  scoreScenePrompt,
  type ScenePromptGrade,
  type ScenePromptOutput,
} from "@/evals/scene-prompt/score";

const filler = (count: number) => Array.from({ length: count }, () => "stone").join(" ");
const GOOD =
  "A 16:9 frame holds a central cluster. In the foreground a brass key rests on a table; the midground holds a " +
  "door; the background fades to white. Eye-level camera at medium distance. Soft morning light falls from the left. " +
  filler(170);

const GRADE: ScenePromptGrade = {
  lead_story: 1,
  depicted_story: 1,
  one_dominant_subject: true,
  at_most_one_supporting_element: true,
  central_vignette: true,
  no_text_or_screens: true,
  logo_rule: true,
  visible_only: false,
  no_extra_elements: true,
  thumbnail_readability: 3,
  lead_relevance: 2,
  note: "ok",
};

const outcome = (output: ScenePromptOutput | null, grade: ScenePromptGrade | null = null): Outcome<unknown, ScenePromptOutput, ScenePromptGrade> =>
  outcomeOf({ item: {}, output, grade, error: output ? null : "timeout" });

describe("checkSceneText and checkScenePrompt", () => {
  it("passes a prompt that follows every hard rule", () => {
    const checks = checkScenePrompt({ scenePrompt: GOOD, rationale: "It shows the key. It is simple." });
    expect(checks).toMatchObject({ ratioCount: 1, layers: true, camera: true, lighting: true, interpretiveWords: [], styleWords: [] });
    expect(checks.words).toBeGreaterThanOrEqual(200);
    expect(checks.rationaleSentences).toBe(2);
    expect(passesScenePromptRules(checks)).toBe(true);
  });

  it("finds forbidden words in their forms, a missing layer, and 16:9 twice", () => {
    const checks = checkScenePrompt({
      scenePrompt: "A 16:9 frame, 16:9 again. Foreground and background. The door symbolizes hope in watercolor, a theme.",
      rationale: "",
    });
    expect(checks.ratioCount).toBe(2);
    expect(checks.layers).toBe(false);
    expect(checks.interpretiveWords).toEqual(["symbolizes", "theme"]);
    expect(checks.styleWords).toEqual(["watercolor"]);
    expect(passesScenePromptRules(checks)).toBe(false);
  });

  it("accepts 'middle ground' for the midground and does not flag words that only contain a forbidden one", () => {
    const checks = checkSceneText("Foreground, middle ground, background. Workers implement the theater lights.");
    expect(checks.layers).toBe(true);
    expect(checks.interpretiveWords).toEqual([]);
  });
});

describe("scoreScenePrompt", () => {
  it("counts checks over all runs (an error is a miss) and grades over the graded runs", () => {
    const metrics = scoreScenePrompt([
      outcome({ scenePrompt: GOOD, rationale: "Short." }, GRADE),
      outcome({ scenePrompt: "Too short, 16:9.", rationale: "Short." }, { ...GRADE, depicted_story: 2, lead_relevance: 0 }),
      outcome({ scenePrompt: "Too short, 16:9.", rationale: "Short." }),
      outcome(null),
    ]);
    const byName = new Map(metrics.map((metric) => [metric.name, metric]));
    expect(byName.get("All hard rules")).toEqual({ name: "All hard rules", hits: 1, n: 4 });
    expect(byName.get("16:9 once")).toEqual({ name: "16:9 once", hits: 3, n: 4 });
    expect(byName.get("J: visible only")).toEqual({ name: "J: visible only", hits: 0, n: 2 });
    expect(byName.get("J: depicts lead")).toEqual({ name: "J: depicts lead", hits: 1, n: 2 });
    expect(byName.get("J: relevance mean (0–3)")).toEqual({ name: "J: relevance mean (0–3)", value: 1 });
  });
});

describe("sceneIssueFrom", () => {
  it("builds the context the draft builds: the subject line and the top stories' headline and detail", () => {
    const issue = sceneIssueFrom({
      id: "262",
      date: "2026-10-26",
      content: {
        title: "A Made-Up Subject",
        headlines: [{ story_id: 1, url: "https://example.com", headline: "Made-up headline", story_detail: "Made-up detail.", bullets: [] }],
      } as never,
    });
    expect(issue).toEqual({
      issueId: 262,
      date: "2026-10-26",
      context: { subjectLine: "A Made-Up Subject", topStories: [{ headline: "Made-up headline", detail: "Made-up detail." }] },
    });
  });
});
