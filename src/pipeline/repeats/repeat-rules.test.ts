import { describe, expect, it } from "vitest";
import { applyRepeatRules, pairLevel, windowDaysFromSetting, type RepeatReference, type StoryMatchRow } from "@/src/pipeline/repeats/repeat-rules";

function match(newer: number, older: number, same: number, news = 0.1): StoryMatchRow {
  return { newerStoryId: newer, olderStoryId: older, similarity: 0.8, same, news };
}

const SURE = 0.95;
const SIMILAR = 0.6;

function refs(entries: [number, RepeatReference][]) {
  return new Map(entries);
}

describe("pairLevel", () => {
  it("is sure only when the pair is the same news and nothing new", () => {
    expect(pairLevel({ same: 0.85, news: 0.5 })).toBe("sure");
    expect(pairLevel({ same: 0.99, news: 0.51 })).toBe("similar");
    expect(pairLevel({ same: 0.84, news: 0 })).toBe("similar");
    expect(pairLevel({ same: 0.5, news: 0 })).toBe("similar");
    expect(pairLevel({ same: 0.49, news: 0 })).toBeNull();
  });
});

describe("windowDaysFromSetting", () => {
  it("uses the setting when it is a positive number, otherwise 14", () => {
    expect(windowDaysFromSetting(10)).toBe(10);
    expect(windowDaysFromSetting(null)).toBe(14);
    expect(windowDaysFromSetting(0)).toBe(14);
    expect(windowDaysFromSetting("10")).toBe(14);
  });
});

describe("applyRepeatRules", () => {
  const published = refs([[100, { headline: "Old story", date: "2026-11-02", kind: "published" }]]);

  it("removes a candidate with a sure pair to a published story", () => {
    const result = applyRepeatRules({
      candidates: [{ id: 1 }, { id: 2 }],
      matches: [match(1, 100, SURE)],
      references: published,
      excluded: new Map(),
    });
    expect(result.heads).toEqual([{ id: 2 }]);
    expect(result.removed).toEqual([{ story: { id: 1 }, repeatOf: { id: 100, headline: "Old story", date: "2026-11-02", kind: "published" } }]);
  });

  it("removes a candidate with a sure pair to a held story, and names the closest reference", () => {
    const result = applyRepeatRules({
      candidates: [{ id: 1 }],
      matches: [match(1, 100, 0.9), match(1, 101, 0.97)],
      references: refs([
        [100, { headline: "Published", date: "2026-11-02", kind: "published" }],
        [101, { headline: "In the draft", date: "2026-11-04", kind: "held" }],
      ]),
      excluded: new Map(),
    });
    expect(result.heads).toEqual([]);
    expect(result.removed[0].repeatOf).toEqual({ id: 101, headline: "In the draft", date: "2026-11-04", kind: "held" });
  });

  it("labels a candidate with a similar pair to a reference", () => {
    const result = applyRepeatRules({
      candidates: [{ id: 1 }],
      matches: [match(1, 100, SIMILAR)],
      references: published,
      excluded: new Map(),
    });
    expect(result.heads).toEqual([{ id: 1 }]);
    expect(result.similarTo.get(1)).toEqual([{ kind: "published", id: 100, headline: "Old story", date: "2026-11-02" }]);
  });

  it("never removes through a chain of pairs, but labels it", () => {
    // 1 is sure-same as 50 (not a reference), and 50 is sure-same as published 100.
    const result = applyRepeatRules({
      candidates: [{ id: 1 }],
      matches: [match(1, 50, SURE), match(50, 100, SURE)],
      references: published,
      excluded: new Map(),
    });
    expect(result.removed).toEqual([]);
    expect(result.heads).toEqual([{ id: 1 }]);
    expect(result.similarTo.get(1)).toEqual([{ kind: "published", id: 100, headline: "Old story", date: "2026-11-02" }]);
  });

  it("does not label a chain whose first pair is under the similar level", () => {
    const result = applyRepeatRules({
      candidates: [{ id: 1 }],
      matches: [match(1, 50, 0.4), match(50, 100, SURE)],
      references: published,
      excluded: new Map(),
    });
    expect(result.similarTo.has(1)).toBe(false);
  });

  it("merges two candidates with a sure pair into the higher-ranked one", () => {
    const result = applyRepeatRules({
      candidates: [{ id: 3 }, { id: 2 }, { id: 1 }],
      matches: [match(3, 1, SURE), match(2, 1, SIMILAR)],
      references: new Map(),
      excluded: new Map(),
    });
    expect(result.heads).toEqual([{ id: 3 }, { id: 2 }]);
    expect(result.merged).toEqual([{ story: { id: 1 }, into: 3 }]);
  });

  it("merges into heads only, so a chain of candidates does not collapse into one", () => {
    // 1~2 sure, 2~3 sure, 1~3 nothing: 2 merges into 1; 3 has no sure pair to the head 1, so it stays.
    const result = applyRepeatRules({
      candidates: [{ id: 1 }, { id: 2 }, { id: 3 }],
      matches: [match(2, 1, SURE), match(3, 2, SURE)],
      references: new Map(),
      excluded: new Map(),
    });
    expect(result.heads.map((story) => story.id)).toEqual([1, 3]);
    expect(result.merged).toEqual([{ story: { id: 2 }, into: 1 }]);
  });

  it("labels a head from the stories merged into it", () => {
    const result = applyRepeatRules({
      candidates: [{ id: 1 }, { id: 2 }],
      matches: [match(2, 1, SURE), match(2, 100, SIMILAR)],
      references: published,
      excluded: new Map(),
    });
    expect(result.similarTo.get(1)).toEqual([{ kind: "published", id: 100, headline: "Old story", date: "2026-11-02" }]);
  });

  it("labels a pair to an excluded story with the date it was excluded", () => {
    const result = applyRepeatRules({
      candidates: [{ id: 1 }, { id: 2 }],
      matches: [match(1, 200, SURE), match(2, 201, SIMILAR)],
      references: new Map(),
      excluded: new Map([
        [200, { headline: "Excluded", excludedOn: "2026-11-05" }],
        [201, { headline: "Excluded long ago", excludedOn: null }],
      ]),
    });
    expect(result.heads).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.similarTo.get(1)).toEqual([{ kind: "excluded", id: 200, headline: "Excluded", date: "2026-11-05" }]);
    expect(result.similarTo.get(2)).toEqual([{ kind: "excluded", id: 201, headline: "Excluded long ago", date: null }]);
  });

  it("does nothing for a pair to a story outside the reference window", () => {
    // The caller leaves stories published more than the window before the board date out of `references`.
    const result = applyRepeatRules({
      candidates: [{ id: 1 }],
      matches: [match(1, 90, SURE)],
      references: published,
      excluded: new Map(),
    });
    expect(result.heads).toEqual([{ id: 1 }]);
    expect(result.removed).toEqual([]);
    expect(result.similarTo.size).toBe(0);
  });

  it("keeps at most 3 labels: references first, then excluded, highest same first, no duplicates", () => {
    const result = applyRepeatRules({
      candidates: [{ id: 1 }, { id: 2 }],
      matches: [
        match(2, 1, SURE),
        match(1, 200, 0.99),
        match(1, 100, 0.6),
        match(2, 100, 0.7),
        match(1, 101, 0.8, 0.9),
        match(1, 102, 0.55),
      ],
      references: refs([
        [100, { headline: "A", date: "2026-11-02", kind: "published" }],
        [101, { headline: "B", date: "2026-11-03", kind: "held" }],
        [102, { headline: "C", date: "2026-11-01", kind: "published" }],
      ]),
      excluded: new Map([[200, { headline: "X", excludedOn: "2026-11-05" }]]),
    });
    expect(result.similarTo.get(1)?.map((entry) => entry.id)).toEqual([101, 100, 102]);
  });
});
