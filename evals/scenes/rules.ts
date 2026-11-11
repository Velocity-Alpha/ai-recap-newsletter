import { countWords } from "@/evals/lib/text";
import { SCENE_IDEAS_INTERPRETIVE_WORDS } from "@/src/pipeline/draft/image/scene-ideas";
import { SCENE_LAYERS, SCENE_PROMPT_INTERPRETIVE_WORDS, SCENE_STYLE_WORDS } from "@/src/pipeline/draft/image/scene-prompt";

/**
 * The scene rules both scene evals check: the scene prompt (src/pipeline/draft/image/scene-prompt.ts) and the scene
 * ideas (scene-ideas.ts) share their composition rules, so they share these checks and the judge's grade. The word
 * lists and layers come from the call sites, so a change to a prompt changes the checks too.
 */

/**
 * A regex source that finds a forbidden word in its forms: "represents" finds represent, representing, ...;
 * "symbolizes" also finds symbolise; "implies" finds imply, implied, implying; "watercolor" finds watercolour.
 */
export function wordForms(word: string): string {
  if (word.includes(" ")) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}(?:y|ies|ied|ying)`;
  if (word.endsWith("izes")) return `${word.slice(0, -4)}i[sz]\\w*`;
  if (word.endsWith("s")) return `${word.slice(0, -1)}\\w*`;
  if (word.endsWith("or")) return `${word.slice(0, -2)}ou?r\\w*`;
  return `${word}\\w*`;
}

/** The scene prompt's forbidden interpretive words, in their forms. */
export const INTERPRETIVE_SCENE_PROMPT = SCENE_PROMPT_INTERPRETIVE_WORDS.map(wordForms);
/** The scene ideas' shorter list. */
export const INTERPRETIVE_SCENE_IDEAS = SCENE_IDEAS_INTERPRETIVE_WORDS.map(wordForms);
/** Style words both prompts forbid: the fixed style prompt owns them. */
const STYLE_WORDS = SCENE_STYLE_WORDS.map(wordForms);

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
    layers: SCENE_LAYERS.every((layer) => lower.includes(layer) || (layer === "midground" && lower.includes("middle ground"))),
    // The prompts ask for "camera angle and distance" and "lighting": these find both in the words scenes usually use.
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
  /** 1-based number of the top story the scene shows; 0 when none. */
  depicted_story: number;
  one_dominant_subject: boolean;
  at_most_one_supporting_element: boolean;
  central_vignette: boolean;
  no_text_or_screens: boolean;
  logo_rule: boolean;
  visible_only: boolean;
  no_extra_elements: boolean;
  /** The scene visibly shows at least one of the golden identifiers of the lead story. */
  identifier_shown: boolean;
  /** The scene shows one of the golden misreads of the lead story. */
  misread: boolean;
  /** 1 to 3, anchored in the rubric. */
  thumbnail_readability: number;
  /** 0 to 3, anchored in the rubric, against the golden lead story and its identifiers. */
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
