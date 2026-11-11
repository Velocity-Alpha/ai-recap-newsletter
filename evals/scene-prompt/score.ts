import type { Metric } from "@/evals/lib/results";
import { mean } from "@/evals/lib/stats";
import { countGraded, gradedOutcomes, type Outcome } from "@/evals/lib/sweep";
import { countSentences, countWords } from "@/evals/lib/text";
import { checkSceneText, GRADE_RULES, type SceneGrade, type SceneTextChecks } from "@/evals/scenes/rules";
import { SCENE_FRAME, SCENE_PROMPT_WORDS, SCENE_RATIONALE_LIMITS } from "@/src/pipeline/draft/image/scene-prompt";

/**
 * Scoring of the scene prompt (src/pipeline/draft/image/scene-prompt.ts): deterministic checks of the prompt's
 * hard rules (the shared scene rules plus its own), and the judge's grade against the golden lead story.
 */

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** The scene prompt's hard rules, from its system prompt and its output schema. */
export interface ScenePromptChecks extends SceneTextChecks {
  /** "Must include '16:9' exactly once" (schema): the count of SCENE_FRAME. */
  ratioCount: number;
  rationaleWords: number;
  rationaleSentences: number;
}

export function checkScenePrompt(output: { scenePrompt: string; rationale: string }): ScenePromptChecks {
  return {
    ...checkSceneText(output.scenePrompt),
    ratioCount: occurrences(output.scenePrompt, SCENE_FRAME),
    rationaleWords: countWords(output.rationale),
    rationaleSentences: countSentences(output.rationale),
  };
}

export function passesScenePromptRules(checks: ScenePromptChecks): boolean {
  return (
    checks.ratioCount === 1 &&
    checks.words >= SCENE_PROMPT_WORDS.min &&
    checks.words <= SCENE_PROMPT_WORDS.max &&
    checks.layers &&
    checks.camera &&
    checks.lighting &&
    checks.interpretiveWords.length === 0 &&
    checks.styleWords.length === 0
  );
}

/** The judge's answer for one scene prompt. */
export interface ScenePromptJudgeAnswer extends SceneGrade {
  note: string;
}

/** The grade of one scene prompt: the judge's answer, and the golden lead story it was graded against. */
export interface ScenePromptGrade extends ScenePromptJudgeAnswer {
  /** 1-based number of the lead story, from the golden value (not the judge). */
  lead_story: number;
}

export function rationaleFits(checks: Pick<ScenePromptChecks, "rationaleWords" | "rationaleSentences">): boolean {
  return (
    checks.rationaleWords <= SCENE_RATIONALE_LIMITS.maxWords &&
    checks.rationaleSentences >= SCENE_RATIONALE_LIMITS.minSentences &&
    checks.rationaleSentences <= SCENE_RATIONALE_LIMITS.maxSentences
  );
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
    check(`${SCENE_FRAME} once`, (checks) => checks.ratioCount === 1),
    check(`${SCENE_PROMPT_WORDS.min}–${SCENE_PROMPT_WORDS.max} words`, (checks) => checks.words >= SCENE_PROMPT_WORDS.min && checks.words <= SCENE_PROMPT_WORDS.max),
    check("Fg/mid/bg", (checks) => checks.layers),
    check("Camera", (checks) => checks.camera),
    check("Lighting", (checks) => checks.lighting),
    check("No interpretive words", (checks) => checks.interpretiveWords.length === 0),
    check("No style words", (checks) => checks.styleWords.length === 0),
    check(
      `Rationale ≤${SCENE_RATIONALE_LIMITS.maxWords} words, ${SCENE_RATIONALE_LIMITS.minSentences}–${SCENE_RATIONALE_LIMITS.maxSentences} sentences`,
      rationaleFits
    ),
    { name: "Words mean", value: Math.round(mean(checked.flatMap(({ checks }) => (checks ? [checks.words] : [])))) },
    ...GRADE_RULES.map(([key, name]) => judged(name, (grade) => grade[key] === true)),
    judged("J: depicts lead", (grade) => grade.depicted_story === grade.lead_story),
    judged("J: shows a lead identifier", (grade) => grade.depicted_story === grade.lead_story && grade.identifier_shown),
    judged("J: no misread", (grade) => !grade.misread),
    judged("J: relevance ≥2", (grade) => grade.lead_relevance >= 2),
    { name: "J: relevance mean (0–3)", value: mean(graded.map((grade) => grade.lead_relevance)) },
    { name: "J: thumbnail mean (1–3)", value: mean(graded.map((grade) => grade.thumbnail_readability)) },
  ];
}
