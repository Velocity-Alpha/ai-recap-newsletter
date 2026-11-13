import { describe, expect, it } from "vitest";

import { auc, fill, groupEvents, rankOf, stream } from "@/evals/section-scoring/fill";

const stories = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
/** Scores by section: story id → score. A missing story scores 0. */
const scores: Record<string, Record<number, number>> = {
  top: { 1: 5, 2: 4, 3: 1 },
  wide: { 1: 5, 2: 4, 3: 3, 4: 2 },
};
const scorer = (story: { id: number }, section: string) => scores[section]?.[story.id] ?? 0;

describe("stream", () => {
  it("orders a section's stories by score and leaves out a story that scores 0", () => {
    expect(stream(stories, "top", scorer).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("puts the lower id first when two stories have the same score", () => {
    const same = () => 1;
    expect(stream([{ id: 9 }, { id: 2 }], "top", same).map((s) => s.id)).toEqual([2, 9]);
  });
});

describe("fill", () => {
  it("fills the sections in fill order, and a selected story leaves the later sections", () => {
    const result = fill(
      stories,
      [
        { key: "top", fillCount: 2 },
        { key: "wide", fillCount: 2 },
      ],
      scorer,
    );
    expect(result.top.map((s) => s.id)).toEqual([1, 2]);
    expect(result.wide.map((s) => s.id)).toEqual([3, 4]);
  });

  it("selects fewer stories when a section has too few", () => {
    expect(fill(stories, [{ key: "top", fillCount: 9 }], scorer).top).toHaveLength(3);
  });
});

describe("rankOf", () => {
  it("gives the place in the stream from 1, and null for a story that is not in it", () => {
    expect(rankOf(stories, "top", scorer, 2)).toBe(2);
    expect(rankOf(stories, "top", scorer, 4)).toBeNull();
  });
});

describe("auc", () => {
  it("is 1 when every positive scores above every negative, and 0.5 when all scores are equal", () => {
    expect(auc([3, 4], [1, 2])).toBe(1);
    expect(auc([1, 1], [1, 1])).toBe(0.5);
  });

  it("counts a tie as half", () => {
    expect(auc([2], [1, 2])).toBe(0.75);
  });
});

describe("groupEvents", () => {
  it("puts stories that are similar, directly or through another story, in one group named by the lowest id", () => {
    const pairs = new Set(["1-2", "2-3"]);
    const similar = (a: number, b: number) => pairs.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
    const groups = groupEvents([3, 1, 2, 4], similar);
    expect(groups.get(3)).toBe(1);
    expect(groups.get(2)).toBe(1);
    expect(groups.get(4)).toBe(4);
  });
});
