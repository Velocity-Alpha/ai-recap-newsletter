import { describe, expect, it } from "vitest";

import { levelOf, scoreRepeats, type PairOutput } from "@/evals/repeats/score";
import type { Outcome } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";
import { SIMILAR_SAME, SURE_MAX_NEWS, SURE_SAME } from "@/src/pipeline/repeats/repeat-rules";

type Item = { label: "same" | "follow_up" | "different" };
const outcome = (label: Item["label"], output: PairOutput | null): Outcome<Item, PairOutput> =>
  outcomeOf({ item: { label }, id: "x", output, error: output ? null : "HTTP 500" });

describe("levelOf", () => {
  it("is sure at the sure thresholds", () => {
    expect(levelOf({ same: SURE_SAME, news: SURE_MAX_NEWS })).toBe("sure");
  });

  it("is similar when the news score is over the sure limit", () => {
    expect(levelOf({ same: SURE_SAME, news: SURE_MAX_NEWS + 0.01 })).toBe("similar");
  });

  it("is no level under the similar threshold", () => {
    expect(levelOf({ same: SIMILAR_SAME - 0.01, news: 0 })).toBeNull();
  });

  it("is no level for a refused pair", () => {
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
