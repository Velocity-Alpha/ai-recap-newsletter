import { describe, expect, it } from "vitest";

import type { Metric } from "@/evals/lib/results";
import type { Outcome } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";
import { checkScenePrompt, passesScenePromptRules, scoreScenePrompt, type ScenePromptGrade, type ScenePromptOutput } from "@/evals/scene-prompt/score";

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

describe("checkScenePrompt", () => {
  it("passes a prompt that follows every hard rule", () => {
    expect(passesScenePromptRules(checkScenePrompt({ scenePrompt: GOOD, rationale: "It shows the key." }))).toBe(true);
  });

  it("counts '16:9', and fails a prompt that has it twice", () => {
    const checks = checkScenePrompt({ scenePrompt: `${GOOD} Again 16:9.`, rationale: "" });
    expect(checks.ratioCount).toBe(2);
    expect(passesScenePromptRules(checks)).toBe(false);
  });

  it("fails a prompt under 200 words", () => {
    expect(passesScenePromptRules(checkScenePrompt({ scenePrompt: "A 16:9 frame. Foreground, midground, background.", rationale: "" }))).toBe(false);
  });

  it("counts the rationale's words and sentences", () => {
    expect(checkScenePrompt({ scenePrompt: GOOD, rationale: "It shows the key. It is simple." })).toMatchObject({
      rationaleWords: 7,
      rationaleSentences: 2,
    });
  });
});

describe("scoreScenePrompt", () => {
  const metrics = (): Map<string, Metric> =>
    new Map(
      scoreScenePrompt([
        outcome({ scenePrompt: GOOD, rationale: "Short." }, GRADE),
        outcome({ scenePrompt: "Too short, 16:9.", rationale: "Short." }, { ...GRADE, depicted_story: 2, lead_relevance: 0 }),
        outcome({ scenePrompt: "Too short, 16:9.", rationale: "Short." }),
        outcome(null),
      ]).map((metric) => [metric.name, metric])
    );

  it("counts each check over all runs, an error as a miss", () => {
    expect(metrics().get("All hard rules")).toEqual({ name: "All hard rules", hits: 1, n: 4 });
    expect(metrics().get("16:9 once")).toEqual({ name: "16:9 once", hits: 3, n: 4 });
  });

  it("counts each judged rule over the graded runs only", () => {
    expect(metrics().get("J: visible only")).toEqual({ name: "J: visible only", hits: 0, n: 2 });
  });

  it("counts a scene as depicting the lead when it shows the story the subject line is about", () => {
    expect(metrics().get("J: depicts lead")).toEqual({ name: "J: depicts lead", hits: 1, n: 2 });
  });

  it("averages the judge's scores over the graded runs", () => {
    expect(metrics().get("J: relevance mean (0–3)")).toEqual({ name: "J: relevance mean (0–3)", value: 1 });
  });
});
