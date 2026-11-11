import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { JudgedStory } from "@/src/pipeline/repeats/decisions";

/** The labelled pairs of the repeat check's test set (src/pipeline/repeats/__fixtures__/README.md). */

const FIXTURES = join(__dirname, "..", "..", "src", "pipeline", "repeats", "__fixtures__");

export type PairLabel = "same" | "follow_up" | "different";

export interface LabelledPair {
  /** "<newer>-<older>". */
  id: string;
  label: PairLabel;
  confidence: string;
  newer: JudgedStory;
  older: JudgedStory;
}

interface FixtureStory {
  id: number;
  day: string;
  headline: string;
  summary: string;
}

function readJsonl<T>(name: string): T[] {
  return readFileSync(join(FIXTURES, name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

/** Is `a` newer than `b`: a later day, or the same day and a higher id (as when the pairs were built). */
export function isNewer(a: { id: number; day: string }, b: { id: number; day: string }): boolean {
  return a.day > b.day || (a.day === b.day && a.id > b.id);
}

export function labelledPairs(): LabelledPair[] {
  const stories = new Map(readJsonl<FixtureStory>("stories.jsonl").map((story) => [story.id, story]));
  const judged = (story: FixtureStory): JudgedStory => ({ id: story.id, headline: story.headline, summary: story.summary });
  return readJsonl<{ a: number; b: number; label: PairLabel; confidence: string }>("labelled-pairs.jsonl").map((pair) => {
    const a = stories.get(pair.a);
    const b = stories.get(pair.b);
    if (!a || !b) throw new Error(`Labelled pair ${pair.a}-${pair.b} has a story that is not in stories.jsonl.`);
    const [newer, older] = isNewer(a, b) ? [a, b] : [b, a];
    return { id: `${newer.id}-${older.id}`, label: pair.label, confidence: pair.confidence, newer: judged(newer), older: judged(older) };
  });
}
