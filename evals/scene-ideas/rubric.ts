import { SCENE_GRADE_PROPERTIES, SCENE_IDEAS_RULE_TEXTS, sceneRulesRubric } from "@/evals/scenes/rubric";
import { SCENE_IDEAS_DIFFERENT, type SceneIdea } from "@/src/pipeline/draft/image/scene-ideas";

/** The judge's rubric for one answer of the scene ideas: each idea on the scene rules, in the ideas' own words, then the set. */

export const SCENE_IDEAS_JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ideas", "clearly_different", "note"],
  properties: {
    ideas: {
      type: "array",
      description: "One grade per idea, in the order given.",
      items: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(SCENE_GRADE_PROPERTIES),
        properties: SCENE_GRADE_PROPERTIES,
      },
    },
    clearly_different: {
      type: "boolean",
      description: "True when every two ideas differ in story, dominant subject, or visual idea, not just in wording.",
    },
    note: { type: "string", description: "One short sentence on the main problem, or 'ok'." },
  },
};

export const SCENE_IDEAS_JUDGE_INSTRUCTIONS = `You grade scene ideas for a newsletter's featured image: short descriptions of an illustration, written by another model from the issue's subject line and top stories, so the owner can pick one. A fixed style prompt is added later, so a scene must not describe style.

The lead story (the top story the subject line is about) and the identifiers of its news are given: grade against them, do not choose another lead. Grade each idea on its own, in the order given. Finally judge the set, clearly_different: "${SCENE_IDEAS_DIFFERENT}"

${sceneRulesRubric(SCENE_IDEAS_RULE_TEXTS)}

Answer in JSON only.`;

export function ideasForJudge(ideas: SceneIdea[]): string {
  return ideas.map((idea, index) => `Idea ${index + 1}: ${idea.label}\n${idea.scene}`).join("\n\n");
}
