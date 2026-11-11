import { readFileSync } from "node:fs";
import { join } from "node:path";

import { goldenFor, type Golden } from "@/evals/lib/golden";
import { readNewPairs, type NewPair } from "@/evals/repeats/new-pairs";
import type { JudgedStory } from "@/src/pipeline/repeats/decisions";

/**
 * The labelled pairs of the repeat check's test set: the fixture's labels (src/pipeline/repeats/__fixtures__/README.md)
 * and the new pairs' golden labels by Claude Opus (new-pairs.ts, golden.json).
 */

export const FIXTURES = join(__dirname, "..", "..", "src", "pipeline", "repeats", "__fixtures__");

export type PairLabel = "same" | "follow_up" | "different";
export type Confidence = "high" | "medium" | "low";
/** Where a label comes from: labelled-pairs.jsonl (a strong model, its README), or golden.json (Claude Opus). */
export type LabelSource = "fixture" | "opus";

export interface LabelledPair {
  /** "<newer>-<older>". */
  id: string;
  label: PairLabel;
  confidence: string;
  labelSource: LabelSource;
  newer: JudgedStory;
  older: JudgedStory;
}

/** The golden value of a new pair. */
export interface PairGolden {
  label: PairLabel;
  confidence: Confidence;
  /** One short sentence, our own words. */
  why: string;
}

export interface FixtureStory {
  id: number;
  day: string;
  headline: string;
  summary: string;
}

export function readJsonl<T>(name: string): T[] {
  return readFileSync(join(FIXTURES, name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

/** Is `a` newer than `b`: a later day, or the same day and a higher id (as when the pairs were built). */
export function isNewer(a: { id: number; day: string }, b: { id: number; day: string }): boolean {
  return a.day > b.day || (a.day === b.day && a.id > b.id);
}

const judged = (story: FixtureStory): JudgedStory => ({ id: story.id, headline: story.headline, summary: story.summary });

function fixtureStories(): Map<number, FixtureStory> {
  return new Map(readJsonl<FixtureStory>("stories.jsonl").map((story) => [story.id, story]));
}

function storyOf(stories: Map<number, FixtureStory>, id: number, pair: string): FixtureStory {
  const story = stories.get(id);
  if (!story) throw new Error(`Pair ${pair} has story ${id}, which is not in stories.jsonl.`);
  return story;
}

export function labelledPairs(): LabelledPair[] {
  const stories = fixtureStories();
  return readJsonl<{ a: number; b: number; label: PairLabel; confidence: string }>("labelled-pairs.jsonl").map((pair) => {
    const a = storyOf(stories, pair.a, `${pair.a}-${pair.b}`);
    const b = storyOf(stories, pair.b, `${pair.a}-${pair.b}`);
    const [newer, older] = isNewer(a, b) ? [a, b] : [b, a];
    return { id: `${newer.id}-${older.id}`, label: pair.label, confidence: pair.confidence, labelSource: "fixture", newer: judged(newer), older: judged(older) };
  });
}

/** A new pair, with its stories as the judge reads them. Its id is "<newer>-<older>". */
export interface NewPairItem {
  id: string;
  pair: NewPair;
  newer: JudgedStory;
  older: JudgedStory;
}

export function newPairItems(pairs: NewPair[] = readNewPairs()): NewPairItem[] {
  const stories = fixtureStories();
  return pairs.map((pair) => {
    const id = `${pair.newer}-${pair.older}`;
    return { id, pair, newer: judged(storyOf(stories, pair.newer, id)), older: judged(storyOf(stories, pair.older, id)) };
  });
}

/** The golden input of a new pair: what a golden agent reads, and what `inputHash` is over. */
export function goldenPairInput(item: { newer: JudgedStory; older: JudgedStory }): { newer: JudgedStory; older: JudgedStory } {
  return { newer: item.newer, older: item.older };
}

/** The new pairs that have a golden value, labelled with it. Throws for a pair whose stories changed since. */
export function opusLabelledPairs(golden: Golden<PairGolden>, items: NewPairItem[] = newPairItems()): LabelledPair[] {
  return items
    .filter((item) => golden.entries[item.id])
    .map((item) => {
      const value = goldenFor(golden, item.id, goldenPairInput(item));
      return { id: item.id, label: value.label, confidence: value.confidence, labelSource: "opus", newer: item.newer, older: item.older };
    });
}
