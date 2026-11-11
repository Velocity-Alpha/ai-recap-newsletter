import { describe, expect, it } from "vitest";

import { labelledPairs } from "@/evals/repeats/pairs";
import { levelOf, scoreRepeats, type PairOutput } from "@/evals/repeats/score";
import type { Outcome } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";
import { SIMILAR_SAME, SURE_MAX_NEWS, SURE_SAME } from "@/src/pipeline/repeats/repeat-rules";

type Item = { label: "same" | "follow_up" | "different" };
const outcome = (label: Item["label"], output: PairOutput | null): Outcome<Item, PairOutput> =>
  outcomeOf({ item: { label }, id: "x", output, error: output ? null : "HTTP 500" });

describe("levelOf", () => {
  it("uses the repeat check's thresholds", () => {
    expect(levelOf({ same: SURE_SAME, news: SURE_MAX_NEWS })).toBe("sure");
    expect(levelOf({ same: SURE_SAME, news: SURE_MAX_NEWS + 0.01 })).toBe("similar");
    expect(levelOf({ same: SIMILAR_SAME - 0.01, news: 0 })).toBeNull();
    expect(levelOf({ refused: true })).toBeNull();
  });
});

describe("scoreRepeats", () => {
  it("counts each measure over the pairs of its label", () => {
    const sure = { same: 0.99, news: 0.01 };
    const similar = { same: 0.6, news: 0.9 };
    const metrics = scoreRepeats([
      outcome("same", sure),
      outcome("same", similar),
      outcome("same", null),
      outcome("different", sure),
      outcome("different", { refused: true }),
      outcome("follow_up", similar),
    ]);
    expect(metrics).toEqual([
      { name: "same -> sure", hits: 1, n: 3 },
      { name: "same -> sure or similar", hits: 2, n: 3 },
      { name: "different -> sure", hits: 1, n: 2 },
      { name: "follow_up -> sure", hits: 0, n: 1 },
      { name: "refused", hits: 1, n: 6 },
    ]);
  });
});

describe("labelledPairs", () => {
  it("reads the 243 labelled pairs, newer story first", () => {
    const pairs = labelledPairs();
    expect(pairs).toHaveLength(243);
    expect(pairs.filter((pair) => pair.label === "same")).toHaveLength(113);
    expect(new Set(pairs.map((pair) => pair.id)).size).toBe(243);
    expect(pairs.every((pair) => pair.newer.id !== pair.older.id && pair.newer.headline && pair.older.headline)).toBe(true);
  });
});
