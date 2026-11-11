import { SCENE_GRADE_PROPERTIES, SCENE_RULES_RUBRIC } from "@/evals/scenes/rubric";

/** The judge's rubric for a scene prompt: the shared scene rules, and which top story the scene shows. */

export const SCENE_PROMPT_JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lead_story", "depicted_story", ...Object.keys(SCENE_GRADE_PROPERTIES), "note"],
  properties: {
    lead_story: { type: "integer", description: "1-based number of the top story the subject line is about; 0 if none." },
    depicted_story: { type: "integer", description: "1-based number of the top story the scene shows; 0 if none." },
    ...SCENE_GRADE_PROPERTIES,
    note: { type: "string", description: "One short sentence on the main problem, or 'ok'." },
  },
};

export const SCENE_PROMPT_JUDGE_INSTRUCTIONS = `You grade the scene prompt of a newsletter's featured image: a description of one illustration, written by another model from the issue's subject line and top stories. A fixed style prompt is added later, so the scene must not describe style.

First find the lead story: the top story the subject line is about. Then find the top story the scene shows.

${SCENE_RULES_RUBRIC}

Answer in JSON only.`;
