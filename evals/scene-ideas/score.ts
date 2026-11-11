import type { Metric } from "@/evals/lib/results";
import type { Outcome } from "@/evals/lib/sweep";
import {
  callLatencyMetrics,
  checkSceneText,
  countWords,
  GRADE_RULES,
  INTERPRETIVE_SCENE_IDEAS,
  mean,
  type SceneGrade,
  type SceneTextChecks,
} from "@/evals/scene-prompt/score";
import { SCENE_IDEAS_COUNT, SCENE_IDEAS_TIMEOUT_MS, type SceneIdea } from "@/src/pipeline/draft/image/scene-ideas";

/** Scoring of the scene ideas (src/pipeline/draft/image/scene-ideas.ts): its prompt's hard rules and the judge. */

export const IDEA_WORDS = { min: 120, max: 200 };
export const LABEL_WORDS = { min: 2, max: 6 };

/** The judge's grade of one idea: the scene rules, and which top story it shows. */
export interface IdeaGrade extends SceneGrade {
  /** 1-based index of the top story the idea shows; 0 when none. */
  depicted_story: number;
}

export interface SceneIdeasGrade {
  /** 1-based index of the top story the subject line is about; 0 when none fits. */
  lead_story: number;
  ideas: IdeaGrade[];
  /** "Make the three scenes clearly different": a different story, dominant subject, or visual idea. */
  clearly_different: boolean;
  note: string;
}

export interface SceneIdeasOutput {
  /** The ideas the call site returns (it keeps at most SCENE_IDEAS_COUNT). */
  ideas: SceneIdea[];
  /** How many ideas the model's answer held, before the call site kept the first three. */
  rawIdeaCount: number;
  callMs: number;
  /** Null when the judge failed twice. */
  grade: SceneIdeasGrade | null;
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
    checks.words >= IDEA_WORDS.min &&
    checks.words <= IDEA_WORDS.max &&
    checks.labelWords >= LABEL_WORDS.min &&
    checks.labelWords <= LABEL_WORDS.max &&
    checks.layers &&
    checks.camera &&
    checks.lighting &&
    checks.interpretiveWords.length === 0 &&
    checks.styleWords.length === 0
  );
}

export function scoreSceneIdeas<I>(outcomes: Outcome<I, SceneIdeasOutput>[]): Metric[] {
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
  const graded = runs.flatMap((run) => (run.grade ? [run.grade] : []));
  const ideaGrades = graded.flatMap((grade) => grade.ideas);
  const judgedIdeas = (name: string, test: (grade: IdeaGrade) => boolean): Metric => ({
    name,
    hits: ideaGrades.filter(test).length,
    n: ideaSlots,
  });
  return [
    runHits(`Exactly ${SCENE_IDEAS_COUNT} ideas`, (run) => run.rawIdeaCount === SCENE_IDEAS_COUNT),
    runHits("All ideas pass hard rules", (run) => run.ideas.length === SCENE_IDEAS_COUNT && run.ideas.every((idea) => passesIdeaRules(checkIdea(idea)))),
    ideaCheck("Idea: all hard rules", passesIdeaRules),
    ideaCheck("Idea: 120–200 words", (checks) => checks.words >= IDEA_WORDS.min && checks.words <= IDEA_WORDS.max),
    ideaCheck("Idea: label 2–6 words", (checks) => checks.labelWords >= LABEL_WORDS.min && checks.labelWords <= LABEL_WORDS.max),
    ideaCheck("Idea: fg/mid/bg, camera, light", (checks) => checks.layers && checks.camera && checks.lighting),
    ideaCheck("Idea: no interpretive or style words", (checks) => checks.interpretiveWords.length === 0 && checks.styleWords.length === 0),
    { name: "Idea words mean", value: Math.round(mean(ideaChecks.map((checks) => checks.words))) },
    ...GRADE_RULES.map(([key, name]) => judgedIdeas(name, (grade) => grade[key] === true)),
    { name: "J: relevance mean (0–3)", value: mean(ideaGrades.map((grade) => grade.lead_relevance)) },
    { name: "J: thumbnail mean (1–3)", value: mean(ideaGrades.map((grade) => grade.thumbnail_readability)) },
    runHits("J: clearly different", (run) => run.grade?.clearly_different === true),
    runHits("J: an idea shows the lead", (run) => {
      const lead = run.grade?.lead_story ?? 0;
      return lead > 0 && (run.grade?.ideas ?? []).some((idea) => idea.depicted_story === lead);
    }),
    runHits("Judged", (run) => run.grade !== null),
    ...callLatencyMetrics(outcomes, SCENE_IDEAS_TIMEOUT_MS),
  ];
}
