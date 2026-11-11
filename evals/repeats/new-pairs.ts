import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The pairs added to the repeat check's test set, with golden labels by Claude Opus (golden.json, golden-todo.md).
 * They are picked from the recorded pairs of src/pipeline/repeats/__fixtures__/ (each story's nearest stories by
 * embedding, judged-pairs.jsonl) that have no label yet, so their stories and recorded answers are already
 * committed. evals/repeats/build-pairs.ts writes evals/repeats/new-pairs.json.
 */

export const NEW_PAIRS_PATH = join("evals", "repeats", "new-pairs.json");

/** Why a pair was picked: what it likely is, so the set holds each kind. */
export type PickReason = "haiku_same" | "haiku_follow_up" | "haiku_unsure" | "similarity";

export interface NewPair {
  newer: number;
  older: number;
  picked: PickReason;
  /** As recorded in judged-pairs.jsonl. */
  similarity: number;
  rank: number;
  same: number;
  news: number;
}

export interface NewPairsFile {
  note: string;
  pairs: NewPair[];
}

export interface RecordedPair {
  newer: number;
  older: number;
  similarity: number;
  rank: number;
  same: number;
  news: number;
}

export interface Block {
  groups: number[][];
  follow_ups: number[][];
  unsure: number[][];
}

/** How many pairs of each kind are picked: 60 in all, so the set grows from 243 to 303 pairs. */
export const PICKS: Record<PickReason, number> = { haiku_same: 20, haiku_follow_up: 15, haiku_unsure: 5, similarity: 20 };
/** Similarity bands for the `similarity` pick, low first, with the pairs from each. */
export const SIMILARITY_BANDS: { from: number; to: number; count: number }[] = [
  { from: 0.55, to: 0.65, count: 4 },
  { from: 0.65, to: 0.75, count: 5 },
  { from: 0.75, to: 0.85, count: 5 },
  { from: 0.85, to: 1.01, count: 6 },
];

export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** `count` items spread evenly over the list (all of them when it is shorter). */
export function evenlySpaced<T>(items: T[], count: number): T[] {
  if (items.length <= count) return [...items];
  return Array.from({ length: count }, (_, index) => items[Math.floor(((index + 0.5) * items.length) / count)]);
}

function pairsOf(groups: number[][]): string[] {
  return groups.flatMap((group) => group.flatMap((a, index) => group.slice(index + 1).map((b) => pairKey(a, b))));
}

/**
 * The new pairs: recorded pairs with no label, in kinds. Haiku's blocks (blocks.jsonl) give the likely same news
 * (`groups`), the likely follow-ups and the pairs it was unsure of; the rest are spread over similarity bands, most
 * of them likely different. Within a kind the pairs are spread over similarity. No pair is picked twice.
 */
export function pickNewPairs(recorded: RecordedPair[], labelled: { a: number; b: number }[], blocks: Block[]): NewPair[] {
  const taken = new Set(labelled.map((pair) => pairKey(pair.a, pair.b)));
  const byKey = new Map(recorded.map((pair) => [pairKey(pair.newer, pair.older), pair]));
  const bySimilarity = (a: RecordedPair, b: RecordedPair) => a.similarity - b.similarity || a.newer - b.newer || a.older - b.older;
  const picked: NewPair[] = [];
  const take = (pairs: RecordedPair[], count: number, reason: PickReason) => {
    const open = pairs.filter((pair) => !taken.has(pairKey(pair.newer, pair.older))).sort(bySimilarity);
    for (const pair of evenlySpaced(open, count)) {
      taken.add(pairKey(pair.newer, pair.older));
      picked.push({ ...pair, picked: reason });
    }
  };
  const recordedOf = (keys: string[]) => [...new Set(keys)].flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : []));
  take(recordedOf(blocks.flatMap((block) => pairsOf(block.groups))), PICKS.haiku_same, "haiku_same");
  take(recordedOf(blocks.flatMap((block) => block.follow_ups.map(([a, b]) => pairKey(a, b)))), PICKS.haiku_follow_up, "haiku_follow_up");
  take(recordedOf(blocks.flatMap((block) => block.unsure.map(([a, b]) => pairKey(a, b)))), PICKS.haiku_unsure, "haiku_unsure");
  for (const band of SIMILARITY_BANDS) {
    take(recorded.filter((pair) => pair.similarity >= band.from && pair.similarity < band.to), band.count, "similarity");
  }
  return picked;
}

export function readNewPairs(path = NEW_PAIRS_PATH): NewPair[] {
  return (JSON.parse(readFileSync(path, "utf8")) as NewPairsFile).pairs;
}
