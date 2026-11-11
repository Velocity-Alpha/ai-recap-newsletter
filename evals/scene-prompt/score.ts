import type { Metric } from "@/evals/lib/results";
import { percentile } from "@/evals/lib/stats";
import { countHits, type Outcome } from "@/evals/lib/sweep";

/**
 * Scoring of the scene prompt (src/pipeline/draft/image/scene-prompt.ts): deterministic checks of the prompt's
 * hard rules, and the judge's grade. The scene ideas eval uses the text checks too.
 */

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Sentences: runs of text that end in . ! or ? (or the end of the text). */
export function countSentences(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Words the prompts forbid as interpretive language, with their forms (represents, symbolizing, ...). */
const INTERPRETIVE_SCENE_PROMPT = [
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

/** The scene prompt's hard rules, from its system prompt and its output schema. */
export interface ScenePromptChecks extends SceneTextChecks {
  /** "Must include '16:9' exactly once" (schema). */
  ratioCount: number;
  rationaleWords: number;
  rationaleSentences: number;
}

export function checkScenePrompt(output: { scenePrompt: string; rationale: string }): ScenePromptChecks {
  return {
    ...checkSceneText(output.scenePrompt),
    ratioCount: occurrences(output.scenePrompt, "16:9"),
    rationaleWords: countWords(output.rationale),
    rationaleSentences: countSentences(output.rationale),
  };
}

export const SCENE_WORDS = { min: 200, max: 300 };

export function passesScenePromptRules(checks: ScenePromptChecks): boolean {
  return (
    checks.ratioCount === 1 &&
    checks.words >= SCENE_WORDS.min &&
    checks.words <= SCENE_WORDS.max &&
    checks.layers &&
    checks.camera &&
    checks.lighting &&
    checks.interpretiveWords.length === 0 &&
    checks.styleWords.length === 0
  );
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

/** The judge's answer for one scene prompt: the grade and which stories it found. */
export interface ScenePromptGrade extends SceneGrade {
  /** 1-based index of the top story the subject line is about; 0 when none fits. */
  lead_story: number;
  /** 1-based index of the top story the scene shows; 0 when none. */
  depicted_story: number;
  note: string;
}

export interface ScenePromptOutput {
  scenePrompt: string;
  rationale: string;
  /** Time of the call site alone, without the judge. */
  callMs: number;
  /** Null when the judge failed twice. */
  grade: ScenePromptGrade | null;
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

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** p50 and p95 of the call site's own time, in seconds, and the runs that finished inside `limitMs`. */
export function callLatencyMetrics<I, O extends { callMs: number }>(outcomes: Outcome<I, O>[], limitMs?: number): Metric[] {
  const times = outcomes.flatMap((outcome) => (outcome.output ? [outcome.output.callMs] : []));
  const seconds = (ms: number | null) => (ms === null ? 0 : Math.round(ms / 100) / 10);
  const metrics: Metric[] = [
    { name: "Call p50 s", value: seconds(percentile(times, 50)) },
    { name: "Call p95 s", value: seconds(percentile(times, 95)) },
  ];
  if (limitMs !== undefined) {
    metrics.push(countHits(`Done in ${limitMs / 1000} s`, outcomes, (outcome) => outcome.output.callMs < limitMs));
  }
  return metrics;
}

export function scoreScenePrompt<I>(outcomes: Outcome<I, ScenePromptOutput>[]): Metric[] {
  const checked = outcomes.map((outcome) => ({ outcome, checks: outcome.output ? checkScenePrompt(outcome.output) : null }));
  const check = (name: string, test: (checks: ScenePromptChecks) => boolean): Metric => ({
    name,
    hits: checked.filter(({ checks }) => checks !== null && test(checks)).length,
    n: outcomes.length,
  });
  const graded = outcomes.flatMap((outcome) => (outcome.output?.grade ? [outcome.output.grade] : []));
  const judged = (name: string, test: (grade: ScenePromptGrade) => boolean): Metric => ({
    name,
    hits: graded.filter(test).length,
    n: outcomes.length,
  });
  return [
    check("All hard rules", passesScenePromptRules),
    check("16:9 once", (checks) => checks.ratioCount === 1),
    check("200–300 words", (checks) => checks.words >= SCENE_WORDS.min && checks.words <= SCENE_WORDS.max),
    check("Fg/mid/bg", (checks) => checks.layers),
    check("Camera", (checks) => checks.camera),
    check("Lighting", (checks) => checks.lighting),
    check("No interpretive words", (checks) => checks.interpretiveWords.length === 0),
    check("No style words", (checks) => checks.styleWords.length === 0),
    check("Rationale ≤45 words, 1–2 sentences", (checks) => checks.rationaleWords <= 45 && checks.rationaleSentences >= 1 && checks.rationaleSentences <= 2),
    { name: "Words mean", value: Math.round(mean(checked.flatMap(({ checks }) => (checks ? [checks.words] : [])))) },
    ...GRADE_RULES.map(([key, name]) => judged(name, (grade) => grade[key] === true)),
    judged("J: depicts lead", (grade) => grade.lead_story > 0 && grade.depicted_story === grade.lead_story),
    judged("J: relevance ≥2", (grade) => grade.lead_relevance >= 2),
    { name: "J: relevance mean (0–3)", value: mean(graded.map((grade) => grade.lead_relevance)) },
    { name: "J: thumbnail mean (1–3)", value: mean(graded.map((grade) => grade.thumbnail_readability)) },
    judged("Judged", () => true),
    ...callLatencyMetrics(outcomes),
  ];
}
