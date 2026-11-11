import { describe, expect, it } from "vitest";

import { labelledPairs } from "@/evals/repeats/pairs";

describe("labelledPairs", () => {
  it("reads the 243 labelled pairs, 113 of them the same story", () => {
    const pairs = labelledPairs();
    expect(pairs).toHaveLength(243);
    expect(pairs.filter((pair) => pair.label === "same")).toHaveLength(113);
  });

  it("gives each pair its own id", () => {
    expect(new Set(labelledPairs().map((pair) => pair.id)).size).toBe(243);
  });

  it("pairs two different stories, each with a headline", () => {
    expect(labelledPairs().every((pair) => pair.newer.id !== pair.older.id && pair.newer.headline && pair.older.headline)).toBe(true);
  });
});
