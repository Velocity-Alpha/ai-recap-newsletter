import type { ScenePromptContext } from "@/src/pipeline/draft/image/scene-prompt";

/**
 * The judge's rubric for one scene (a scene prompt, or one scene idea). Each boolean is one rule the call's prompt
 * states. The two scores have anchors so that the grades of different runs compare.
 */

export const SCENE_RULES_RUBRIC = `Grade each rule as true only when the scene clearly follows it. When in doubt, false.

- one_dominant_subject: the scene names exactly one dominant subject.
- at_most_one_supporting_element: besides the dominant subject there is at most one supporting element, clearly secondary. Setting, light and surfaces do not count; a second object or figure that draws the eye does.
- central_vignette: the subject and supporting element form a central cluster, and the scene says the surroundings taper off or dissolve before the frame edges. Nothing is described as touching or crossing the edge.
- no_text_or_screens: the image can be understood without reading anything: no screens, dashboards, paragraphs, code, UI, charts, or several labels. One short brand mark is allowed.
- logo_rule: no logo or brand mark, or exactly one, small, printed on a physical object in the scene.
- visible_only: it describes only what is visibly present (subjects, objects, setting, light, composition, materials, motion). No interpretive or intent language (what it means, represents, suggests, critiques).
- no_extra_elements: no extra characters, objects or scenery beyond what the scene needs.
- thumbnail_readability: 3 = one bold silhouette, readable at a glance in a small thumbnail; 2 = readable but busy or small in the frame; 1 = cluttered or hard to read small.
- lead_relevance: 3 = it clearly shows the news of the lead story (the top story the subject line is about), with a concrete identifier from it; 2 = it is about the lead story but generic (could fit many AI stories); 1 = it is about another top story, or about AI in general; 0 = unrelated to the issue.`;

export const SCENE_GRADE_PROPERTIES = {
  one_dominant_subject: { type: "boolean" },
  at_most_one_supporting_element: { type: "boolean" },
  central_vignette: { type: "boolean" },
  no_text_or_screens: { type: "boolean" },
  logo_rule: { type: "boolean" },
  visible_only: { type: "boolean" },
  no_extra_elements: { type: "boolean" },
  thumbnail_readability: { type: "integer", enum: [1, 2, 3] },
  lead_relevance: { type: "integer", enum: [0, 1, 2, 3] },
} as const;

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

/** The issue as the judge sees it: subject line and numbered top stories. */
export function issueForJudge(context: ScenePromptContext): string {
  const stories = context.topStories.map((story, index) => `${index + 1}. ${story.headline}\n   ${story.detail}`).join("\n");
  return `Subject line: ${context.subjectLine}\n\nTop stories:\n${stories}`;
}
