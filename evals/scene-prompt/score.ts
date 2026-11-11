import type { Metric } from "@/evals/lib/results";
import { mean } from "@/evals/lib/stats";
import { countGraded, gradedOutcomes, type Outcome } from "@/evals/lib/sweep";
import { countSentences, countWords } from "@/evals/lib/text";
import { checkSceneText, GRADE_RULES, type SceneGrade, type SceneTextChecks } from "@/evals/scenes/rules";

/**
 * Scoring of the scene prompt (src/pipeline/draft/image/scene-prompt.ts): deterministic checks of the prompt's
 * hard rules (the shared scene rules plus its own), and the judge's grade.
 */

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
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
}

export function scoreScenePrompt<I>(outcomes: Outcome<I, ScenePromptOutput, ScenePromptGrade>[]): Metric[] {
  const checked = outcomes.map((outcome) => ({ outcome, checks: outcome.output ? checkScenePrompt(outcome.output) : null }));
  const check = (name: string, test: (checks: ScenePromptChecks) => boolean): Metric => ({
    name,
    hits: checked.filter(({ checks }) => checks !== null && test(checks)).length,
    n: outcomes.length,
  });
  const graded = gradedOutcomes(outcomes).map((outcome) => outcome.grade);
  const judged = (name: string, test: (grade: ScenePromptGrade) => boolean): Metric =>
    countGraded(name, outcomes, (outcome) => test(outcome.grade));
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
  ];
}
