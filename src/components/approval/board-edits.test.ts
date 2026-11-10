import { describe, expect, it } from "vitest";

import { hasBoardEdits } from "@/src/components/approval/board-edits";

const story = (id: number) => ({ id, headline: `Item ${id}`, summary: `Text ${id}` });

const candidateSections = [
  { key: "headlines", label: "Top Stories", max: 3, selected: [story(1), story(2)], fill_ins: [story(3)] },
  { key: "tools", label: "Tools", max: 3, selected: [story(4)], fill_ins: [] },
];

// The board's state right after it loads these sections.
function untouched() {
  return {
    candidateSections,
    sections: [
      {
        key: "headlines",
        stories: [
          { story: story(1), status: "selected" as const },
          { story: story(2), status: "selected" as const },
          { story: story(3), status: "fill-in" as const },
        ],
      },
      { key: "tools", stories: [{ story: story(4), status: "selected" as const }] },
    ],
    headlineStoryId: null,
    excludeState: {},
    urlOverrides: {},
    notesOverrides: {},
  };
}

describe("hasBoardEdits", () => {
  it("is false for a board as it was built", () => {
    expect(hasBoardEdits(untouched())).toBe(false);
  });

  it("sees a story moved between selected and fill-in", () => {
    const board = untouched();
    board.sections[0].stories[1] = { story: story(2), status: "fill-in" };

    expect(hasBoardEdits(board)).toBe(true);
  });

  it("sees a story moved to another section", () => {
    const board = untouched();
    const [moved] = board.sections[0].stories.splice(2, 1);
    board.sections[1].stories.push(moved);

    expect(hasBoardEdits(board)).toBe(true);
  });

  it("sees a chosen headline, an exclusion, a link change and a note", () => {
    expect(hasBoardEdits({ ...untouched(), headlineStoryId: 1 })).toBe(true);
    expect(hasBoardEdits({ ...untouched(), excludeState: { 2: { excluded: true, reason: "" } } })).toBe(true);
    expect(hasBoardEdits({ ...untouched(), urlOverrides: { 1: "https://example.com/a" } })).toBe(true);
    expect(hasBoardEdits({ ...untouched(), notesOverrides: { 1: "Lead with this" } })).toBe(true);
  });

  it("treats the proposed lead as part of the board as built (#58)", () => {
    expect(hasBoardEdits({ ...untouched(), proposedLeadId: 1, headlineStoryId: 1 })).toBe(false);
    expect(hasBoardEdits({ ...untouched(), proposedLeadId: 1, headlineStoryId: 2 })).toBe(true);
    expect(hasBoardEdits({ ...untouched(), proposedLeadId: 1, headlineStoryId: null })).toBe(true);
  });
});
