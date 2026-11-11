import type { Metric } from "@/evals/lib/results";
import { mean } from "@/evals/lib/stats";
import { countGraded, countHits, gradedOutcomes, type Outcome } from "@/evals/lib/sweep";
import { countWords } from "@/evals/lib/text";
import { checkSceneText, GRADE_RULES, INTERPRETIVE_SCENE_IDEAS, type SceneGrade, type SceneTextChecks } from "@/evals/scenes/rules";
import {
  SCENE_IDEA_LABEL_WORDS,
  SCENE_IDEA_WORDS,
  SCENE_IDEAS_COUNT,
  SCENE_IDEAS_TIMEOUT_MS,
  type SceneIdea,
} from "@/src/pipeline/draft/image/scene-ideas";

/**
 * Scoring of the scene ideas (src/pipeline/draft/image/scene-ideas.ts): its prompt's hard rules, and the judge's
 * grade against the golden lead story.
 */

/** The judge's grade of one idea: the scene rules, and which top story it shows. */
export type IdeaGrade = SceneGrade;

/** The judge's answer for one run's ideas. */
export interface SceneIdeasJudgeAnswer {
  ideas: IdeaGrade[];
  /** "Make the three scenes clearly different": a different story, dominant subject, or visual idea. */
  clearly_different: boolean;
  note: string;
}

/** The grade of one run: the judge's answer, and the golden lead story it was graded against. */
export interface SceneIdeasGrade extends SceneIdeasJudgeAnswer {
  /** 1-based number of the lead story, from the golden value (not the judge). */
  lead_story: number;
}

export interface SceneIdeasOutput {
  /** The ideas the call site returns (it keeps at most SCENE_IDEAS_COUNT). */
  ideas: SceneIdea[];
  /** How many ideas the model's answer held, before the call site kept the first three. */
  rawIdeaCount: number;
}

/** The ideas in a raw answer, or 0 when it does not parse. */
export function rawIdeaCount(outputText: string): number {
  try {
    const ideas = (JSON.parse(outputText) as { ideas?: unknown })?.ideas;
    return Array.isArray(ideas) ? ideas.length : 0;
  } catch {
    return 0;
  }
}

export interface IdeaChecks extends SceneTextChecks {
  labelWords: number;
}

export function checkIdea(idea: SceneIdea): IdeaChecks {
  return { ...checkSceneText(idea.scene, INTERPRETIVE_SCENE_IDEAS), labelWords: countWords(idea.label) };
}

export function passesIdeaRules(checks: IdeaChecks): boolean {
  return (
    checks.words >= SCENE_IDEA_WORDS.min &&
    checks.words <= SCENE_IDEA_WORDS.max &&
    checks.labelWords >= SCENE_IDEA_LABEL_WORDS.min &&
    checks.labelWords <= SCENE_IDEA_LABEL_WORDS.max &&
    checks.layers &&
    checks.camera &&
    checks.lighting &&
    checks.interpretiveWords.length === 0 &&
    checks.styleWords.length === 0
  );
}

export function scoreSceneIdeas<I>(outcomes: Outcome<I, SceneIdeasOutput, SceneIdeasGrade>[]): Metric[] {
  const runs = outcomes.flatMap((outcome) => (outcome.output ? [outcome.output] : []));
  const ideaChecks = runs.flatMap((run) => run.ideas.map(checkIdea));
  // Idea counts are over the ideas a full answer would have: three for every run, errors included.
  const ideaSlots = outcomes.length * SCENE_IDEAS_COUNT;
  const ideaCheck = (name: string, test: (checks: IdeaChecks) => boolean): Metric => ({
    name,
    hits: ideaChecks.filter(test).length,
    n: ideaSlots,
  });
  const runHits = (name: string, test: (run: SceneIdeasOutput) => boolean): Metric => ({
    name,
    hits: runs.filter(test).length,
    n: outcomes.length,
  });
  // Judged idea counts are over three ideas for every graded run.
  const graded = gradedOutcomes(outcomes);
  const ideaGrades = graded.flatMap((outcome) => outcome.grade.ideas);
  const judgedIdeas = (name: string, test: (grade: IdeaGrade) => boolean): Metric => ({
    name,
    hits: ideaGrades.filter(test).length,
    n: graded.length * SCENE_IDEAS_COUNT,
  });
  return [
    runHits(`Exactly ${SCENE_IDEAS_COUNT} ideas`, (run) => run.rawIdeaCount === SCENE_IDEAS_COUNT),
    runHits("All ideas pass hard rules", (run) => run.ideas.length === SCENE_IDEAS_COUNT && run.ideas.every((idea) => passesIdeaRules(checkIdea(idea)))),
    ideaCheck("Idea: all hard rules", passesIdeaRules),
    ideaCheck(`Idea: ${SCENE_IDEA_WORDS.min}–${SCENE_IDEA_WORDS.max} words`, (checks) => checks.words >= SCENE_IDEA_WORDS.min && checks.words <= SCENE_IDEA_WORDS.max),
    ideaCheck(`Idea: label ${SCENE_IDEA_LABEL_WORDS.min}–${SCENE_IDEA_LABEL_WORDS.max} words`, (checks) => checks.labelWords >= SCENE_IDEA_LABEL_WORDS.min && checks.labelWords <= SCENE_IDEA_LABEL_WORDS.max),
    ideaCheck("Idea: fg/mid/bg, camera, light", (checks) => checks.layers && checks.camera && checks.lighting),
    ideaCheck("Idea: no interpretive or style words", (checks) => checks.interpretiveWords.length === 0 && checks.styleWords.length === 0),
    { name: "Idea words mean", value: Math.round(mean(ideaChecks.map((checks) => checks.words))) },
    ...GRADE_RULES.map(([key, name]) => judgedIdeas(name, (grade) => grade[key] === true)),
    { name: "J: relevance mean (0–3)", value: mean(ideaGrades.map((grade) => grade.lead_relevance)) },
    { name: "J: thumbnail mean (1–3)", value: mean(ideaGrades.map((grade) => grade.thumbnail_readability)) },
    countGraded("J: clearly different", outcomes, (outcome) => outcome.grade.clearly_different),
    countGraded("J: an idea shows the lead", outcomes, (outcome) =>
      outcome.grade.ideas.some((idea) => idea.depicted_story === outcome.grade.lead_story)
    ),
    countGraded("J: an idea shows a lead identifier", outcomes, (outcome) =>
      outcome.grade.ideas.some((idea) => idea.depicted_story === outcome.grade.lead_story && idea.identifier_shown)
    ),
    judgedIdeas("J: no misread", (grade) => !grade.misread),
    countHits(`Done in ${SCENE_IDEAS_TIMEOUT_MS / 1000} s`, outcomes, (outcome) => outcome.latencyMs < SCENE_IDEAS_TIMEOUT_MS),
  ];
}
