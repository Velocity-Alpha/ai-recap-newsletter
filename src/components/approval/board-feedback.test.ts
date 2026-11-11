import { describe, expect, it } from "vitest";

import { feedbackBody, isMoved, proposedSectionsOf } from "@/components/approval/board-feedback";

const PROPOSED = [
  { key: "headlines", story_ids: [1, 2] },
  { key: "tools", story_ids: [3] },
];

const slots = (...ids: number[]) => ids.map((id) => ({ story: { id } }));

describe("proposedSectionsOf", () => {
  it("takes the selected stories of each section in order, not the fill-ins", () => {
    const built = [
      { key: "headlines", selected: [{ id: 1 }, { id: 2 }], fill_ins: [{ id: 9 }] },
      { key: "tools", selected: [{ id: 3 }], fill_ins: [] },
    ];
    expect(proposedSectionsOf(built)).toEqual(PROPOSED);
  });
});

describe("isMoved", () => {
  it("is true only for a proposed story in another section", () => {
    expect(isMoved(PROPOSED, 2, "tools")).toBe(true);
    expect(isMoved(PROPOSED, 2, "headlines")).toBe(false);
    expect(isMoved(PROPOSED, 9, "tools")).toBe(false);
  });
});

describe("feedbackBody", () => {
  const board = {
    proposed: PROPOSED,
    sections: [
      { key: "headlines", stories: slots(1) },
      { key: "tools", stories: slots(3, 2) },
    ],
    headlineStoryId: 3,
    proposedLeadId: 1,
    leadReasons: { 3: { code: "bigger story", text: "" } },
    moveReasons: { 2: { code: "", text: " it is a tool " } },
  };

  it("sends the reasons for the lead change and the move that exist at commit", () => {
    expect(feedbackBody(board)).toEqual([
      { story_id: 3, action: "lead", code: "bigger story", text: "" },
      { story_id: 2, action: "move", code: "", text: "it is a tool" },
    ]);
  });

  it("sends no reason for a difference the owner took back, or for a reason with no tap and no text", () => {
    expect(
      feedbackBody({
        ...board,
        sections: [
          { key: "headlines", stories: slots(1, 2) },
          { key: "tools", stories: slots(3) },
        ],
        headlineStoryId: 1,
      }),
    ).toEqual([]);
    expect(feedbackBody({ ...board, leadReasons: { 3: { code: "", text: " " } }, moveReasons: {} })).toEqual([]);
  });
});
