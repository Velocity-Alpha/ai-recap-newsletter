import { SCENE_GRADE_PROPERTIES, SCENE_PROMPT_RULE_TEXTS, sceneRulesRubric } from "@/evals/scenes/rubric";

/** The judge's rubric for a scene prompt: the shared scene rules, in the scene prompt's own words. */

export const SCENE_PROMPT_JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...Object.keys(SCENE_GRADE_PROPERTIES), "note"],
  properties: {
    ...SCENE_GRADE_PROPERTIES,
    note: { type: "string", description: "One short sentence on the main problem, or 'ok'." },
  },
};

export const SCENE_PROMPT_JUDGE_INSTRUCTIONS = `You grade the scene prompt of a newsletter's featured image: a description of one illustration, written by another model from the issue's subject line and top stories. A fixed style prompt is added later, so the scene must not describe style.

The lead story (the top story the subject line is about) and the identifiers of its news are given: grade against them, do not choose another lead. First find the top story the scene shows.

${sceneRulesRubric(SCENE_PROMPT_RULE_TEXTS)}

Answer in JSON only.`;
