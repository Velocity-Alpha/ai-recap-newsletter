/**
 * The golden set for section scoring (#177): the scorer's recommendation for a story, the hard cases that make a
 * label teach the most, and the sampler that picks the check set and the tuning batches. Pure: the same stories and
 * seed always give the same sets.
 */
import { seededRandom } from "@/evals/lib/stats";
import type { Kind, Recommendation } from "@/evals/section-scoring/labels";
import { NONE, type StoryScores } from "@/evals/section-scoring/sections";

/** A story of the golden-set pool, with what the sampler needs. The page never shows the extraction fields. */
export interface PoolStory {
  id: number;
  /** The kind from the extraction category: research, tools, or general for every other category. */
  extractionKind: Exclude<Kind, "none">;
  /** The extraction importance, 1 to 5 (0 when missing). */
  extractionImportance: number;
  /** Whether the rebuilt board of the scoring test showed the story to the owner. */
  shown: boolean;
  scores: StoryScores;
}

/**
 * split: a second kind also fits (0.5 or more). category: the recommended kind is not the extraction's.
 * importance: the scorer's and the extraction's importance differ by 2 or more. never_shown: the board never showed it.
 */
export type HardCase = "split" | "category" | "importance" | "never_shown";

/** A second kind fits when its predicate is this likely or more. */
const ALSO_FITS = 0.5;
const IMPORTANCE_GAP = 2;

/** How well a story fits each kind. General news fits through Top Stories or Quick Hits, whichever fits more. */
function kindFits(scores: StoryScores): [Exclude<Kind, "none">, number][] {
  const { fits } = scores;
  return [
    ["general", Math.max(fits.headlines ?? 0, fits.quick_hits ?? 0)],
    ["research", fits.research_and_analysis ?? 0],
    ["tools", fits.tools ?? 0],
  ];
}

/**
 * The scorer's answer, from the scores of the first test (version 7ca6fcd6): "not a story" when the `choice`
 * question prefers none over every section, otherwise the kind that fits most. Importance rounded to a level.
 */
export function recommend(scores: StoryScores): Recommendation {
  const importance = Math.min(5, Math.max(1, Math.round(scores.importance)));
  const sections = Object.entries(scores.choice).filter(([key]) => key !== NONE);
  const none = scores.choice[NONE] ?? 0;
  if (sections.every(([, probability]) => none > probability)) return { kind: "none", importance };
  const [best] = [...kindFits(scores)].sort((a, b) => b[1] - a[1]);
  return { kind: best[0], importance };
}

export function hardCases(story: PoolStory): HardCase[] {
  const cases: HardCase[] = [];
  const fits = kindFits(story.scores).map(([, fit]) => fit).sort((a, b) => b - a);
  if (fits[1] >= ALSO_FITS) cases.push("split");
  if (recommend(story.scores).kind !== story.extractionKind) cases.push("category");
  if (Math.abs(story.scores.importance - story.extractionImportance) >= IMPORTANCE_GAP) cases.push("importance");
  if (!story.shown) cases.push("never_shown");
  return cases;
}

/** The stories in id order, each with a seeded random key, so the result does not depend on the input order. */
function shuffled<S extends { id: number }>(stories: readonly S[], seed: number): S[] {
  const random = seededRandom(seed);
  const keys = new Map([...stories].sort((a, b) => a.id - b.id).map((story) => [story.id, random()]));
  return [...stories].sort((a, b) => keys.get(a.id)! - keys.get(b.id)!);
}

/** The check set: a plain random sample, fixed at the start. The first `hidden` of it are shown with no recommendation. */
export function pickCheckSet(
  pool: readonly PoolStory[],
  options: { size: number; hidden: number; seed: number },
): { ids: number[]; hidden: number[] } {
  const ids = shuffled(pool, options.seed)
    .slice(0, options.size)
    .map((story) => story.id);
  return { ids, hidden: ids.slice(0, options.hidden) };
}

const RULES: readonly HardCase[] = ["split", "category", "importance", "never_shown"];

/**
 * A tuning batch. It takes one story of each hard-case rule in turn, so one batch teaches every rule; within a rule,
 * the stories with more hard cases first, ties in seeded random order. Stories with no hard case come last. At most
 * one story per event, and none of the excluded stories (the check set and the earlier batches) or of their events.
 */
export function pickTuningBatch(
  pool: readonly PoolStory[],
  options: { size: number; seed: number; exclude: ReadonlySet<number>; eventOf?: ReadonlyMap<number, number> },
): number[] {
  const ordered = shuffled(
    pool.filter((story) => !options.exclude.has(story.id)),
    options.seed,
  )
    .map((story) => ({ id: story.id, cases: hardCases(story) }))
    .sort((a, b) => b.cases.length - a.cases.length);
  const ruleQueues = RULES.map((rule) => ordered.filter((story) => story.cases.includes(rule)));
  const rest = [...ordered];
  const eventOf = (id: number) => options.eventOf?.get(id) ?? id;
  const events = new Set([...options.exclude].map(eventOf));
  const batch: number[] = [];
  /** Takes the first story of the queue whose event is not in the batch yet. */
  const take = (queue: typeof ordered) => {
    while (queue.length > 0) {
      const { id } = queue.shift()!;
      if (events.has(eventOf(id))) continue;
      events.add(eventOf(id));
      batch.push(id);
      return;
    }
  };
  while (batch.length < options.size && ruleQueues.some((queue) => queue.length > 0)) {
    for (const queue of ruleQueues) if (batch.length < options.size) take(queue);
  }
  while (batch.length < options.size && rest.length > 0) take(rest);
  return batch;
}
