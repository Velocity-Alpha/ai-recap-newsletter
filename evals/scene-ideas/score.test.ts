import { describe, expect, it } from "vitest";

import { checkIdea, passesIdeaRules, rawIdeaCount, scoreSceneIdeas, type IdeaGrade, type SceneIdeasOutput } from "@/evals/scene-ideas/score";
import type { Outcome } from "@/evals/lib/sweep";

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

const outcome = (output: SceneIdeasOutput | null): Outcome<unknown, SceneIdeasOutput> => ({
  item: {},
  id: "2026-10-26",
  repeat: 0,
  latencyMs: 1,
  output,
  error: output ? null : "Scene ideas failed: Request timed out.",
});

describe("checkIdea", () => {
  it("passes an idea that follows the hard rules", () => {
    expect(passesIdeaRules(checkIdea(GOOD))).toBe(true);
  });

  it("fails a one-word label, a short scene, and a forbidden word", () => {
    expect(passesIdeaRules(checkIdea({ ...GOOD, label: "Key" }))).toBe(false);
    expect(passesIdeaRules(checkIdea({ ...GOOD, scene: "Foreground, midground, background, camera close, light." }))).toBe(false);
    expect(checkIdea({ ...GOOD, scene: `${SCENE} It represents trust.` }).interpretiveWords).toEqual(["represents"]);
  });
});

describe("rawIdeaCount", () => {
  it("counts the ideas of the raw answer, and 0 for an answer that does not parse", () => {
    expect(rawIdeaCount(JSON.stringify({ ideas: [{}, {}, {}, {}] }))).toBe(4);
    expect(rawIdeaCount("not json")).toBe(0);
  });
});

describe("scoreSceneIdeas", () => {
  it("counts runs and ideas; a timeout is a miss for every column and for the 45 s limit", () => {
    const metrics = scoreSceneIdeas([
      outcome({
        ideas: [GOOD, GOOD, GOOD],
        rawIdeaCount: 3,
        callMs: 10_000,
        grade: { lead_story: 1, ideas: [IDEA_GRADE, IDEA_GRADE, { ...IDEA_GRADE, depicted_story: 2 }], clearly_different: false, note: "" },
      }),
      outcome({ ideas: [GOOD, { ...GOOD, label: "Key" }], rawIdeaCount: 2, callMs: 30_000, grade: null }),
      outcome(null),
    ]);
    const byName = new Map(metrics.map((metric) => [metric.name, metric]));
    expect(byName.get("Exactly 3 ideas")).toEqual({ name: "Exactly 3 ideas", hits: 1, n: 3 });
    expect(byName.get("All ideas pass hard rules")).toEqual({ name: "All ideas pass hard rules", hits: 1, n: 3 });
    expect(byName.get("Idea: all hard rules")).toEqual({ name: "Idea: all hard rules", hits: 4, n: 9 });
    expect(byName.get("J: no extras")).toEqual({ name: "J: no extras", hits: 0, n: 9 });
    expect(byName.get("J: visible only")).toEqual({ name: "J: visible only", hits: 3, n: 9 });
    expect(byName.get("J: an idea shows the lead")).toEqual({ name: "J: an idea shows the lead", hits: 1, n: 3 });
    expect(byName.get("J: clearly different")).toEqual({ name: "J: clearly different", hits: 0, n: 3 });
    expect(byName.get("Done in 45 s")).toEqual({ name: "Done in 45 s", hits: 2, n: 3 });
    expect(byName.get("Call p95 s")).toEqual({ name: "Call p95 s", value: 30 });
  });
});
