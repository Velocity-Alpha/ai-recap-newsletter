import type { SceneGolden } from "@/evals/scenes/golden";
import { SCENE_IDEAS_COMPOSITION, SCENE_IDEAS_SCENE_RULES } from "@/src/pipeline/draft/image/scene-ideas";
import {
  SCENE_PROMPT_COMPOSITION,
  SCENE_PROMPT_IMAGE_RULES,
  SCENE_REQUIREMENT_RULES,
  type ScenePromptContext,
} from "@/src/pipeline/draft/image/scene-prompt";

/**
 * The judge's rubric for one scene (a scene prompt, or one scene idea). Each boolean is one rule the call's prompt
 * states. The rule texts are imported from the call sites and quoted, never retyped: the rubric only adds how to
 * grade them. The two scores have anchors so that the grades of different runs compare. Lead relevance is graded
 * against the golden lead story and its identifiers (evals/scenes/golden.json), not a lead the judge finds itself.
 */

/** The prompt's own words for each judged rule. Each call has its own wording. */
export interface SceneRuleTexts {
  hierarchy: readonly string[];
  vignette: readonly string[];
  noScreens: readonly string[];
  logo: readonly string[];
  visibleOnly: readonly string[];
  noExtras: readonly string[];
  thumbnail: readonly string[];
}

/** The scene prompt's rules: its system prompt and the scene requirements of its input. */
export const SCENE_PROMPT_RULE_TEXTS: SceneRuleTexts = {
  hierarchy: [SCENE_PROMPT_COMPOSITION.hierarchy, SCENE_REQUIREMENT_RULES.supporting],
  vignette: [
    SCENE_PROMPT_COMPOSITION.centralVignette,
    SCENE_PROMPT_COMPOSITION.noEdges,
    SCENE_PROMPT_COMPOSITION.centralCluster,
    SCENE_PROMPT_IMAGE_RULES.taper,
  ],
  noScreens: [SCENE_PROMPT_COMPOSITION.noScreens],
  logo: [SCENE_PROMPT_COMPOSITION.logo, SCENE_REQUIREMENT_RULES.logos],
  visibleOnly: [SCENE_PROMPT_IMAGE_RULES.visibleOnly, SCENE_PROMPT_IMAGE_RULES.interpretive],
  noExtras: [SCENE_PROMPT_COMPOSITION.noExtras],
  thumbnail: [SCENE_PROMPT_COMPOSITION.thumbnail],
};

/** The scene ideas' rules: their instructions and the scene requirements of their input. */
export const SCENE_IDEAS_RULE_TEXTS: SceneRuleTexts = {
  hierarchy: [SCENE_IDEAS_COMPOSITION.hierarchy, SCENE_REQUIREMENT_RULES.supporting],
  vignette: [SCENE_IDEAS_COMPOSITION.centralVignette, SCENE_REQUIREMENT_RULES.vignette],
  noScreens: [SCENE_IDEAS_COMPOSITION.noScreens],
  logo: [SCENE_IDEAS_COMPOSITION.logo, SCENE_REQUIREMENT_RULES.logos],
  visibleOnly: [SCENE_IDEAS_SCENE_RULES.visibleOnly, SCENE_IDEAS_SCENE_RULES.interpretive, SCENE_REQUIREMENT_RULES.visibleOnly],
  noExtras: [SCENE_REQUIREMENT_RULES.identifiers, SCENE_REQUIREMENT_RULES.simple],
  thumbnail: [SCENE_IDEAS_COMPOSITION.thumbnail],
};

const quoted = (texts: readonly string[]) => texts.map((text) => `"${text}"`).join(" ");

/** The rubric of the shared scene grade, quoting the call's rules. */
export function sceneRulesRubric(rules: SceneRuleTexts): string {
  return `Grade each rule as true only when the scene clearly follows it. When in doubt, false. After each rule name, the prompt's own words are quoted, then how to grade it.

- depicted_story: the 1-based number of the top story the scene shows; 0 if none.
- one_dominant_subject: ${quoted(rules.hierarchy)} True when the scene names exactly one dominant subject.
- at_most_one_supporting_element: ${quoted(rules.hierarchy)} True when, besides the dominant subject, there is at most one supporting element, clearly secondary. Setting, light and surfaces do not count; a second object or figure that draws the eye does.
- central_vignette: ${quoted(rules.vignette)} True when the subject and supporting element form a central cluster, and the scene says the surroundings taper off or dissolve before the frame edges. Nothing is described as touching or crossing the edge.
- no_text_or_screens: ${quoted(rules.noScreens)} True when the image can be understood without reading anything. One short brand mark is allowed.
- logo_rule: ${quoted(rules.logo)} True when there is no logo or brand mark, or exactly one, small, printed on a physical object in the scene.
- visible_only: ${quoted(rules.visibleOnly)} True when it describes only what is visibly present, with no interpretive or intent language (what it means, represents, suggests, critiques).
- no_extra_elements: ${quoted(rules.noExtras)} True when there are no extra characters, objects or scenery beyond what the scene needs.
- thumbnail_readability: ${quoted(rules.thumbnail)} 3 = one bold silhouette, readable at a glance in a small thumbnail; 2 = readable but busy or small in the frame; 1 = cluttered or hard to read small.
- identifier_shown: true when the scene visibly shows at least one of the lead story's identifiers given below: by name, as a small printed mark, or as the object itself.
- misread: true when the scene shows one of the misreads given below. False when none are given.
- lead_relevance: 3 = it clearly shows the news of the given lead story, with at least one of its given identifiers; 2 = it is about the lead story but generic (could fit many AI stories); 1 = it is about another top story, or about AI in general; 0 = unrelated to the issue.`;
}

export const SCENE_GRADE_PROPERTIES = {
  depicted_story: { type: "integer", description: "1-based number of the top story the scene shows; 0 if none." },
  one_dominant_subject: { type: "boolean" },
  at_most_one_supporting_element: { type: "boolean" },
  central_vignette: { type: "boolean" },
  no_text_or_screens: { type: "boolean" },
  logo_rule: { type: "boolean" },
  visible_only: { type: "boolean" },
  no_extra_elements: { type: "boolean" },
  identifier_shown: { type: "boolean" },
  misread: { type: "boolean" },
  thumbnail_readability: { type: "integer", enum: [1, 2, 3] },
  lead_relevance: { type: "integer", enum: [0, 1, 2, 3] },
} as const;

/** The issue as the judge sees it: subject line and numbered top stories, then the golden lead and its identifiers. */
export function issueForJudge(context: ScenePromptContext, golden: SceneGolden): string {
  const stories = context.topStories.map((story, index) => `${index + 1}. ${story.headline}\n   ${story.detail}`).join("\n");
  const lead = context.topStories[golden.lead_story - 1];
  const misreads = golden.forbidden_misreads?.length ? golden.forbidden_misreads.join("; ") : "none given";
  return [
    `Subject line: ${context.subjectLine}`,
    `Top stories:\n${stories}`,
    `Lead story (given): ${golden.lead_story}. ${lead?.headline ?? ""}`,
    `Identifiers of the lead story's news a scene should show: ${golden.identifiers.join("; ")}`,
    `Misreads of the lead story: ${misreads}`,
  ].join("\n\n");
}
