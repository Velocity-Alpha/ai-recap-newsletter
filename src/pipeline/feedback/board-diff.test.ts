import { describe, expect, it } from "vitest";

import type { ApprovalOutline, BoardFeedback, ProposedBoard } from "@/src/pipeline/draft/outline";
import { diffBoard, type BoardActionRow } from "@/src/pipeline/feedback/board-diff";

/** The board as proposed: two sections, lead 11, and one repeat the board removed. */
const PROPOSED: ProposedBoard = {
  sections: [
    { key: "headlines", storyIds: [11, 12, 13] },
    { key: "tools", storyIds: [21, 22] },
  ],
  leadStoryId: 11,
  repeatsRemoved: [41],
};

const STORED: Map<number, string | null> = new Map(
  [11, 12, 13, 21, 22, 31, 41].map((id) => [id, `https://example.test/${id}`]),
);

/** A committed outline. Each approved story keeps its stored link unless `urls` says otherwise. */
function outline(
  sections: Record<string, number[]>,
  options: { lead?: number | null; urls?: Record<number, string | null>; excluded?: ApprovalOutline["excluded"] } = {},
): ApprovalOutline {
  const entries = Object.entries(sections);
  return {
    date: "2099-01-05",
    sections: entries.map(([key, storyIds]) => ({ key, storyIds })),
    leadStoryId: options.lead === undefined ? 11 : options.lead,
    stories: entries.flatMap(([section, ids]) =>
      ids.map((id) => ({
        id,
        section,
        url: options.urls && id in options.urls ? options.urls[id] : `https://example.test/${id}`,
        note: "",
      })),
    ),
    excluded: options.excluded ?? [],
  };
}

const UNCHANGED = { headlines: [11, 12, 13], tools: [21, 22] };

function diff(committed: ApprovalOutline, proposed: ProposedBoard | null = PROPOSED, feedback: BoardFeedback[] = []) {
  return diffBoard({ proposed, outline: committed, storedUrls: STORED, feedback });
}

function row(fields: Partial<BoardActionRow> & Pick<BoardActionRow, "action">): BoardActionRow {
  return {
    storyId: null,
    fromSection: null,
    toSection: null,
    fromPosition: null,
    toPosition: null,
    reasonCode: null,
    reasonText: null,
    detail: null,
    ...fields,
  };
}

describe("diffBoard", () => {
  it("gives no rows for a board committed unchanged", () => {
    expect(diff(outline(UNCHANGED))).toEqual([]);
  });

  it("exclude: a proposed story that is not approved", () => {
    expect(diff(outline({ headlines: [11, 13], tools: [21, 22] }))).toEqual([
      row({ action: "exclude", storyId: 12, fromSection: "headlines", fromPosition: 2 }),
    ]);
  });

  it("exclude: carries the code and the text the owner gave", () => {
    const excluded = [{ id: 12, section: "headlines", reason: " seen it last week ", reasonCode: " repeat " }];
    expect(diff(outline({ headlines: [11, 13], tools: [21, 22] }, { excluded }))).toEqual([
      row({ action: "exclude", storyId: 12, fromSection: "headlines", fromPosition: 2, reasonCode: "repeat", reasonText: "seen it last week" }),
    ]);
  });

  it("exclude: a reason with no tap and no text is null", () => {
    const excluded = [{ id: 12, section: "headlines", reason: "  ", reasonCode: "" }];
    expect(diff(outline({ headlines: [11, 13], tools: [21, 22] }, { excluded }))[0]).toMatchObject({ reasonCode: null, reasonText: null });
  });

  it("cuts the code to 40 characters and the text to 500", () => {
    const excluded = [{ id: 12, section: "headlines", reason: "t".repeat(600), reasonCode: "c".repeat(60) }];
    const [excludeRow] = diff(outline({ headlines: [11, 13], tools: [21, 22] }, { excluded }));
    expect(excludeRow.reasonCode).toHaveLength(40);
    expect(excludeRow.reasonText).toHaveLength(500);
  });

  it("add: an approved story that was not proposed and is not a removed repeat", () => {
    expect(diff(outline({ headlines: [11, 12, 13], tools: [21, 22, 31] }))).toEqual([
      row({ action: "add", storyId: 31, toSection: "tools", toPosition: 3 }),
    ]);
  });

  it("restore_repeat: an approved story the board had removed as a repeat", () => {
    expect(diff(outline({ headlines: [11, 12, 13, 41], tools: [21, 22] }))).toEqual([
      row({ action: "restore_repeat", storyId: 41, toSection: "headlines", toPosition: 4 }),
    ]);
  });

  it("move: a story in both, in another section, with the reason the owner gave; no reorder", () => {
    const feedback: BoardFeedback[] = [{ storyId: 13, action: "move", code: "wrong section", text: "it is a tool" }];
    expect(diff(outline({ headlines: [11, 12], tools: [21, 22, 13] }), PROPOSED, feedback)).toEqual([
      row({
        action: "move",
        storyId: 13,
        fromSection: "headlines",
        fromPosition: 3,
        toSection: "tools",
        toPosition: 3,
        reasonCode: "wrong section",
        reasonText: "it is a tool",
      }),
    ]);
  });

  it("move: a story moved to the top of another section gives no reorder for the stories there", () => {
    const rows = diff(outline({ headlines: [11, 12], tools: [13, 21, 22] }));
    expect(rows.map((entry) => entry.action)).toEqual(["move"]);
  });

  it("reorder: one row for the section, with the order before and after", () => {
    expect(diff(outline({ headlines: [12, 11, 13], tools: [21, 22] }))).toEqual([
      row({ action: "reorder", toSection: "headlines", detail: { before: [11, 12, 13], after: [12, 11, 13] } }),
    ]);
  });

  it("reorder: removing one story from a section gives no reorder for the others", () => {
    const rows = diff(outline({ headlines: [11, 13], tools: [21, 22] }));
    expect(rows.map((entry) => entry.action)).toEqual(["exclude"]);
  });

  it("lead: the committed lead is not the proposed lead, with the reason the owner gave", () => {
    const feedback: BoardFeedback[] = [{ storyId: 12, action: "lead", code: "bigger story", text: "" }];
    expect(diff(outline(UNCHANGED, { lead: 12 }), PROPOSED, feedback)).toEqual([
      row({ action: "lead", storyId: 12, reasonCode: "bigger story", detail: { from: 11 } }),
    ]);
  });

  it("lead: a cleared lead has no story id", () => {
    expect(diff(outline(UNCHANGED, { lead: null }))).toEqual([row({ action: "lead", detail: { from: 11 } })]);
  });

  it("lead: a reason given for another lead than the committed one is not used", () => {
    const feedback: BoardFeedback[] = [{ storyId: 13, action: "lead", code: "more reach", text: "" }];
    expect(diff(outline(UNCHANGED, { lead: 12 }), PROPOSED, feedback)[0]).toMatchObject({ reasonCode: null });
  });

  it("link: an approved story whose link differs from the stored one", () => {
    expect(diff(outline(UNCHANGED, { urls: { 21: " https://free.example/21 " } }))).toEqual([
      row({ action: "link", storyId: 21, detail: { from: "https://example.test/21", to: "https://free.example/21" } }),
    ]);
  });

  it("link: an empty link in the outline is no change, and a story with no stored link has from null", () => {
    const storedUrls = new Map(STORED).set(22, null);
    const committed = outline(UNCHANGED, { urls: { 21: "", 12: null, 22: "https://new.example/22" } });
    expect(diffBoard({ proposed: PROPOSED, outline: committed, storedUrls, feedback: [] })).toEqual([
      row({ action: "link", storyId: 22, detail: { from: null, to: "https://new.example/22" } }),
    ]);
  });

  it("link: the link of a story that is not approved gives no row", () => {
    const committed = outline({ headlines: [11, 13], tools: [21, 22] });
    committed.stories.push({ id: 12, section: "headlines", url: "https://other.example/12", note: "" });
    expect(diff(committed).map((entry) => entry.action)).toEqual(["exclude"]);
  });

  it("gives a story at most one of exclude, add, restore_repeat, move; lead and link rows are extra", () => {
    const rows = diff(outline({ headlines: [12, 13], tools: [21, 22, 11] }, { lead: 11, urls: { 11: "https://free.example/11" } }));
    expect(rows).toEqual([
      row({ action: "move", storyId: 11, fromSection: "headlines", fromPosition: 1, toSection: "tools", toPosition: 3 }),
      row({ action: "link", storyId: 11, detail: { from: "https://example.test/11", to: "https://free.example/11" } }),
    ]);
  });

  it("gives only the link rows when there is no proposed board", () => {
    const committed = outline({ headlines: [13, 12] }, { lead: 12, urls: { 13: "https://free.example/13" } });
    expect(diff(committed, null)).toEqual([
      row({ action: "link", storyId: 13, detail: { from: "https://example.test/13", to: "https://free.example/13" } }),
    ]);
  });
});
