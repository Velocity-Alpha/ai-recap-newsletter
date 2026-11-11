import { countWords } from "@/evals/lib/text";

/**
 * The scene rules both scene evals check: the scene prompt (src/pipeline/draft/image/scene-prompt.ts) and the scene
 * ideas (scene-ideas.ts) share their composition rules, so they share these checks and the judge's grade.
 */

/** Words the prompts forbid as interpretive language, with their forms (represents, symbolizing, ...). */
export const INTERPRETIVE_SCENE_PROMPT = [
  "represent\\w*",
  "symboli[sz]\\w*",
  "suggest\\w*",
  "impl(?:y|ies|ied|ying)",
  "commentary",
  "metaphor\\w*",
  "theme\\w*",
  "message\\w*",
  "critique\\w*",
  "scrutiny",
  "oversight",
  "regulation\\w*",
];
/** The scene ideas' shorter list. */
export const INTERPRETIVE_SCENE_IDEAS = ["represent\\w*", "symboli[sz]\\w*", "suggest\\w*", "metaphor\\w*", "theme\\w*", "message\\w*"];
/** Style words both prompts forbid: the fixed style prompt owns them. */
const STYLE_WORDS = ["watercolou?r\\w*", "palette\\w*", "negative space", "technique\\w*"];

function found(text: string, patterns: readonly string[]): string[] {
  return patterns.flatMap((pattern) => text.match(new RegExp(`\\b${pattern}\\b`, "gi")) ?? []).map((word) => word.toLowerCase());
}

/** The rules every scene text has (both prompts): layers, camera, lighting, no interpretive or style words. */
export interface SceneTextChecks {
  words: number;
  layers: boolean;
  camera: boolean;
  lighting: boolean;
  interpretiveWords: string[];
  styleWords: string[];
}

export function checkSceneText(text: string, interpretive: readonly string[] = INTERPRETIVE_SCENE_PROMPT): SceneTextChecks {
  const lower = text.toLowerCase();
  return {
    words: countWords(text),
    layers: ["foreground", "midground", "background"].every((layer) => lower.includes(layer) || (layer === "midground" && lower.includes("middle ground"))),
    // A camera angle and a distance, in the words prompts usually use.
    camera:
      /\b(camera|angle|eye[- ]level|overhead|bird'?s[- ]eye|low[- ]angle|high[- ]angle|three-quarter|vantage)\b/i.test(text) &&
      /\b(close|medium|wide|distance|distant|shot|framed|feet|meters|metres|pulled back|full[- ]length|across the)\b/i.test(text),
    lighting: /\b(light\w*|lit|glow\w*|sun\w*|shadow\w*|illuminat\w*|lamp\w*)\b/i.test(text),
    interpretiveWords: found(text, interpretive),
    styleWords: found(text, STYLE_WORDS),
  };
}

/** The judge's grade of one scene. Every field is asked for (strict JSON). */
export interface SceneGrade {
  one_dominant_subject: boolean;
  at_most_one_supporting_element: boolean;
  central_vignette: boolean;
  no_text_or_screens: boolean;
  logo_rule: boolean;
  visible_only: boolean;
  no_extra_elements: boolean;
  /** 1 to 3, anchored in the rubric. */
  thumbnail_readability: number;
  /** 0 to 3, anchored in the rubric. */
  lead_relevance: number;
}

/** The judged booleans, with their column names. Both scene evals use them. */
export const GRADE_RULES: Array<[keyof SceneGrade, string]> = [
  ["one_dominant_subject", "J: one dominant subject"],
  ["at_most_one_supporting_element", "J: ≤1 supporting element"],
  ["central_vignette", "J: central vignette"],
  ["no_text_or_screens", "J: no text or screens"],
  ["logo_rule", "J: logo rule"],
  ["visible_only", "J: visible only"],
  ["no_extra_elements", "J: no extras"],
];
