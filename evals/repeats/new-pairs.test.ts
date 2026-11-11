import { describe, expect, it } from "vitest";

import { evenlySpaced, pairKey, pickNewPairs, PICKS, readNewPairs, type RecordedPair } from "@/evals/repeats/new-pairs";
import { labelledPairs, newPairItems } from "@/evals/repeats/pairs";

const recorded = (newer: number, older: number, similarity: number): RecordedPair => ({ newer, older, similarity, rank: 1, same: 0.5, news: 0.5 });

describe("evenlySpaced", () => {
  it("spreads the picks over the list", () => {
    expect(evenlySpaced([1, 2, 3, 4, 5, 6], 2)).toEqual([2, 5]);
  });

  it("gives the whole list when it is short", () => {
    expect(evenlySpaced([1, 2], 5)).toEqual([1, 2]);
  });
});

describe("pickNewPairs", () => {
  it("picks recorded pairs with no label, by kind, each once", () => {
    const pairs = [recorded(2, 1, 0.9), recorded(3, 1, 0.8), recorded(4, 3, 0.7), recorded(5, 4, 0.6)];
    const blocks = [{ groups: [[1, 2, 3]], follow_ups: [[4, 3]], unsure: [[2, 1]] }];
    const picked = pickNewPairs(pairs, [{ a: 1, b: 3 }], blocks);
    expect(picked.map((pair) => [pairKey(pair.newer, pair.older), pair.picked])).toEqual([
      ["1-2", "haiku_same"],
      ["3-4", "haiku_follow_up"],
      ["4-5", "similarity"],
    ]);
  });
});

describe("the committed new pairs", () => {
  const pairs = readNewPairs();

  it(`has ${Object.values(PICKS).reduce((a, b) => a + b, 0)} pairs of each kind, none of them labelled before`, () => {
    for (const [reason, count] of Object.entries(PICKS)) expect(pairs.filter((pair) => pair.picked === reason)).toHaveLength(count);
    const labelled = new Set(labelledPairs().map((pair) => pairKey(pair.newer.id, pair.older.id)));
    expect(pairs.some((pair) => labelled.has(pairKey(pair.newer, pair.older)))).toBe(false);
    expect(new Set(pairs.map((pair) => pairKey(pair.newer, pair.older))).size).toBe(pairs.length);
  });

  it("pairs two stories of the fixture, each with a headline", () => {
    expect(newPairItems(pairs).every((item) => item.newer.headline && item.older.headline && item.newer.id !== item.older.id)).toBe(true);
  });
});
