import { describe, expect, it } from "vitest";

import type { Metric } from "@/evals/lib/results";
import type { Outcome } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";
import {
  checkIdea,
  passesIdeaRules,
  rawIdeaCount,
  scoreSceneIdeas,
  type IdeaGrade,
  type SceneIdeasGrade,
  type SceneIdeasOutput,
} from "@/evals/scene-ideas/score";

const filler = (count: number) => Array.from({ length: count }, () => "stone").join(" ");
const SCENE =
  "In the foreground a brass key rests on a table; the midground holds a door; the background fades to white. " +
  "Eye-level camera at medium distance. Soft morning light. " +
  filler(110);
const GOOD = { label: "Brass key on table", scene: SCENE };

const IDEA_GRADE: IdeaGrade = {
  depicted_story: 1,
  one_dominant_subject: true,
  at_most_one_supporting_element: true,
  central_vignette: true,
  no_text_or_screens: true,
  logo_rule: true,
  visible_only: true,
  no_extra_elements: false,
  thumbnail_readability: 2,
  lead_relevance: 3,
};

const outcome = (
  output: SceneIdeasOutput | null,
  latencyMs: number,
  grade: SceneIdeasGrade | null = null
): Outcome<unknown, SceneIdeasOutput, SceneIdeasGrade> =>
  outcomeOf({ item: {}, output, latencyMs, grade, error: output ? null : "Scene ideas failed: Request timed out." });

describe("checkIdea", () => {
  it("passes an idea that follows the hard rules", () => {
    expect(passesIdeaRules(checkIdea(GOOD))).toBe(true);
  });

  it("fails a one-word label", () => {
    expect(passesIdeaRules(checkIdea({ ...GOOD, label: "Key" }))).toBe(false);
  });

  it("fails a scene under 120 words", () => {
    expect(passesIdeaRules(checkIdea({ ...GOOD, scene: "Foreground, midground, background, camera close, light." }))).toBe(false);
  });

  it("finds the interpretive words of the ideas' list", () => {
    expect(checkIdea({ ...GOOD, scene: `${SCENE} It represents trust.` }).interpretiveWords).toEqual(["represents"]);
  });
});

describe("rawIdeaCount", () => {
  it("counts the ideas of the raw answer", () => {
    expect(rawIdeaCount(JSON.stringify({ ideas: [{}, {}, {}, {}] }))).toBe(4);
  });

  it("is 0 for an answer that does not parse", () => {
    expect(rawIdeaCount("not json")).toBe(0);
  });
});

describe("scoreSceneIdeas", () => {
  const metrics = (): Map<string, Metric> =>
    new Map(
      scoreSceneIdeas([
        outcome({ ideas: [GOOD, GOOD, GOOD], rawIdeaCount: 3 }, 10_000, {
          lead_story: 1,
          ideas: [IDEA_GRADE, IDEA_GRADE, { ...IDEA_GRADE, depicted_story: 2 }],
          clearly_different: false,
          note: "",
        }),
        outcome({ ideas: [GOOD, { ...GOOD, label: "Key" }], rawIdeaCount: 2 }, 30_000),
        outcome(null, 45_000),
      ]).map((metric) => [metric.name, metric])
    );

  it("counts run checks over all runs, an error as a miss", () => {
    expect(metrics().get("Exactly 3 ideas")).toEqual({ name: "Exactly 3 ideas", hits: 1, n: 3 });
    expect(metrics().get("All ideas pass hard rules")).toEqual({ name: "All ideas pass hard rules", hits: 1, n: 3 });
  });

  it("counts idea checks over 3 ideas per run, a missing idea as a miss", () => {
    expect(metrics().get("Idea: all hard rules")).toEqual({ name: "Idea: all hard rules", hits: 4, n: 9 });
  });

  it("counts judged idea rules over 3 ideas per graded run", () => {
    expect(metrics().get("J: no extras")).toEqual({ name: "J: no extras", hits: 0, n: 3 });
    expect(metrics().get("J: visible only")).toEqual({ name: "J: visible only", hits: 3, n: 3 });
  });

  it("counts judged set rules over the graded runs", () => {
    expect(metrics().get("J: an idea shows the lead")).toEqual({ name: "J: an idea shows the lead", hits: 1, n: 1 });
    expect(metrics().get("J: clearly different")).toEqual({ name: "J: clearly different", hits: 0, n: 1 });
  });

  it("counts a run at the 45 s limit, or a timeout, as not done in time", () => {
    expect(metrics().get("Done in 45 s")).toEqual({ name: "Done in 45 s", hits: 2, n: 3 });
  });
});
