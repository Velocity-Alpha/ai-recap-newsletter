import { describe, expect, it } from "vitest";

import {
  hardCases,
  pickCheckSet,
  pickTuningBatch,
  recommend,
  type PoolStory,
} from "@/evals/section-scoring/golden-set";
import type { StoryScores } from "@/evals/section-scoring/sections";

/** Scores of a plain Top Stories kind story: general fits, nothing else does, importance 3. */
function scores(over: Partial<StoryScores> = {}, fits: Partial<StoryScores["fits"]> = {}): StoryScores {
  return {
    choice: { headlines: 0.7, research_and_analysis: 0, tools: 0.1, quick_hits: 0.2, none: 0 },
    fits: { headlines: 0.9, research_and_analysis: 0.05, tools: 0.1, quick_hits: 0.4, ...fits },
    importance: 3.1,
    importanceLevels: [0, 0.1, 0.7, 0.2, 0],
    ...over,
  };
}

/** A story with no hard case: the scorer agrees with the extraction, and the board showed it. */
function story(id: number, over: Partial<PoolStory> = {}): PoolStory {
  return { id, extractionKind: "general", extractionImportance: 3, shown: true, scores: scores(), ...over };
}

describe("recommend", () => {
  it("recommends the kind with the highest fit; general news fits through Top Stories or Quick Hits", () => {
    expect(recommend(scores()).kind).toBe("general");
    expect(recommend(scores({}, { headlines: 0.1, quick_hits: 0.8 })).kind).toBe("general");
    expect(recommend(scores({}, { headlines: 0.2, quick_hits: 0.2, research_and_analysis: 0.9 })).kind).toBe("research");
    expect(recommend(scores({}, { headlines: 0.2, quick_hits: 0.6, tools: 0.95 })).kind).toBe("tools");
  });

  it("recommends 'not a story' when the scorer's choice prefers none over every section", () => {
    const junk = scores({ choice: { headlines: 0.1, research_and_analysis: 0, tools: 0.2, quick_hits: 0.2, none: 0.5 } });
    expect(recommend(junk).kind).toBe("none");
  });

  it("recommends the importance rounded to a level from 1 to 5", () => {
    expect(recommend(scores({ importance: 3.4 })).importance).toBe(3);
    expect(recommend(scores({ importance: 4.6 })).importance).toBe(5);
    expect(recommend(scores({ importance: 0.7 })).importance).toBe(1);
  });
});

describe("hardCases", () => {
  it("finds none for a story where the scorer agrees with the extraction and the board showed it", () => {
    expect(hardCases(story(1))).toEqual([]);
  });

  it("finds a split when a second kind also fits (0.5 or more)", () => {
    expect(hardCases(story(1, { scores: scores({}, { tools: 0.6 }) }))).toEqual(["split"]);
  });

  it("finds a category disagreement when the recommended kind is not the extraction's", () => {
    expect(hardCases(story(1, { extractionKind: "tools" }))).toEqual(["category"]);
  });

  it("finds an importance gap when the scorer's and the extraction's importance differ by 2 or more", () => {
    expect(hardCases(story(1, { extractionImportance: 1 }))).toEqual(["importance"]);
    expect(hardCases(story(1, { extractionImportance: 2 }))).toEqual([]);
  });

  it("finds a story the board never showed", () => {
    expect(hardCases(story(1, { shown: false }))).toEqual(["never_shown"]);
  });
});

describe("pickCheckSet", () => {
  const pool = Array.from({ length: 400 }, (_, i) => story(i + 1));

  it("picks the asked number of stories, and hides the recommendation for some of them", () => {
    const check = pickCheckSet(pool, { size: 150, hidden: 50, seed: 7 });
    expect(new Set(check.ids).size).toBe(150);
    expect(check.hidden).toHaveLength(50);
    expect(check.hidden.every((id) => check.ids.includes(id))).toBe(true);
  });

  it("gives the same set for the same seed, and another set for another seed", () => {
    const a = pickCheckSet(pool, { size: 150, hidden: 50, seed: 7 });
    expect(pickCheckSet(pool, { size: 150, hidden: 50, seed: 7 })).toEqual(a);
    expect(pickCheckSet(pool, { size: 150, hidden: 50, seed: 8 }).ids).not.toEqual(a.ids);
  });

  it("does not depend on the order of the pool", () => {
    const a = pickCheckSet(pool, { size: 150, hidden: 50, seed: 7 });
    expect(pickCheckSet([...pool].reverse(), { size: 150, hidden: 50, seed: 7 })).toEqual(a);
  });

  it("is a plain random sample: it does not prefer hard cases", () => {
    const mixed = pool.map((s) => (s.id % 2 === 0 ? { ...s, shown: false } : s));
    const hard = pickCheckSet(mixed, { size: 150, hidden: 50, seed: 7 }).ids.filter((id) => id % 2 === 0).length;
    expect(hard).toBeGreaterThan(50);
    expect(hard).toBeLessThan(100);
  });
});

describe("pickTuningBatch", () => {
  it("leaves out the stories it is told to leave out (the check set and earlier batches)", () => {
    const pool = Array.from({ length: 20 }, (_, i) => story(i + 1, { shown: false }));
    const batch = pickTuningBatch(pool, { size: 10, seed: 7, exclude: new Set([1, 2, 3]) });
    expect(batch).toHaveLength(10);
    expect(batch.some((id) => id <= 3)).toBe(false);
  });

  const split = scores({}, { tools: 0.6 });

  it("takes the hard cases of each rule in turn, so every rule is in the batch", () => {
    const pool = [
      story(1, { scores: split }),
      story(2, { scores: split }),
      story(3, { shown: false }),
      story(4, { shown: false }),
      story(5, { extractionImportance: 1 }),
      story(6),
    ];
    const batch = pickTuningBatch(pool, { size: 3, seed: 7, exclude: new Set() });
    expect(batch).toContain(5);
    expect(batch.filter((id) => id === 1 || id === 2)).toHaveLength(1);
    expect(batch.filter((id) => id === 3 || id === 4)).toHaveLength(1);
  });

  it("takes a story with no hard case only when the hard cases run out", () => {
    const pool = [story(1, { shown: false }), story(2), story(3, { scores: split })];
    expect(pickTuningBatch(pool, { size: 2, seed: 7, exclude: new Set() }).sort()).toEqual([1, 3]);
    expect(pickTuningBatch(pool, { size: 3, seed: 7, exclude: new Set() })[2]).toBe(2);
  });

  it("prefers, within a rule, the story with more hard cases", () => {
    const pool = [story(1, { scores: split }), story(2, { scores: split, shown: false })];
    expect(pickTuningBatch(pool, { size: 1, seed: 7, exclude: new Set() })).toEqual([2]);
  });

  it("takes at most one story of an event", () => {
    const pool = [story(1, { shown: false }), story(2, { shown: false }), story(3, { shown: false })];
    const eventOf = new Map([
      [1, 1],
      [2, 1],
      [3, 3],
    ]);
    const batch = pickTuningBatch(pool, { size: 3, seed: 7, exclude: new Set(), eventOf });
    expect(batch).toHaveLength(2);
    expect(batch).toContain(3);
  });

  it("takes no story of an event that an excluded story reports, so the check set stays unseen", () => {
    const pool = [story(1, { shown: false }), story(2, { shown: false }), story(3, { shown: false })];
    const eventOf = new Map([
      [1, 1],
      [2, 1],
      [3, 3],
    ]);
    expect(pickTuningBatch(pool, { size: 3, seed: 7, exclude: new Set([1]), eventOf })).toEqual([3]);
  });

  it("gives the same batch for the same seed", () => {
    const pool = Array.from({ length: 50 }, (_, i) => story(i + 1, { shown: i % 3 === 0 }));
    const options = { size: 20, seed: 7, exclude: new Set<number>() };
    expect(pickTuningBatch(pool, options)).toEqual(pickTuningBatch([...pool].reverse(), options));
  });
});
