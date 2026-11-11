import { SCENE_GRADE_PROPERTIES, SCENE_RULES_RUBRIC } from "@/evals/scene-prompt/rubric";
import type { SceneIdea } from "@/src/pipeline/draft/image/scene-ideas";

/** The judge's rubric for one answer of the scene ideas: each idea on the scene rules, then the set. */

export const SCENE_IDEAS_JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lead_story", "ideas", "clearly_different", "note"],
  properties: {
    lead_story: { type: "integer", description: "1-based number of the top story the subject line is about; 0 if none." },
    ideas: {
      type: "array",
      description: "One grade per idea, in the order given.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["depicted_story", ...Object.keys(SCENE_GRADE_PROPERTIES)],
        properties: {
          depicted_story: { type: "integer", description: "1-based number of the top story the idea shows; 0 if none." },
          ...SCENE_GRADE_PROPERTIES,
        },
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

First find the lead story: the top story the subject line is about. Then grade each idea on its own, in the order given. Finally judge the set: the ideas must be clearly different (a different story, a different dominant subject, or a different visual idea).

${SCENE_RULES_RUBRIC}

Answer in JSON only.`;

export function ideasForJudge(ideas: SceneIdea[]): string {
  return ideas.map((idea, index) => `Idea ${index + 1}: ${idea.label}\n${idea.scene}`).join("\n\n");
}
