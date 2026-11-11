import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  approvalOutline: { findMany: vi.fn() },
  boardAction: { findMany: vi.fn() },
}));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import { FEEDBACK_DAYS, readFeedback, summarizeFeedback } from "@/src/features/admin/feedback";

/** Two commits on synthetic dates. Story ids are made up. */
const MONDAY = {
  id: 11n,
  issueDate: new Date("2099-01-05T00:00:00Z"),
  proposed: {
    sections: [
      { key: "headlines", storyIds: [1, 2] },
      { key: "tools", storyIds: [3, 4] },
    ],
    leadStoryId: 1,
    repeatsRemoved: [],
  },
  // 2 excluded, 3 moved to headlines, 5 added to tools.
  payload: {
    date: "2099-01-05",
    sections: [
      { key: "headlines", storyIds: [1, 3] },
      { key: "tools", storyIds: [4, 5] },
    ],
    leadStoryId: 3,
    stories: [],
    excluded: [],
  },
};

const TUESDAY = {
  id: 12n,
  issueDate: new Date("2099-01-06T00:00:00Z"),
  proposed: {
    sections: [
      { key: "headlines", storyIds: [6] },
      { key: "tools", storyIds: [7] },
    ],
    leadStoryId: 6,
    repeatsRemoved: [],
  },
  payload: {
    date: "2099-01-06",
    sections: [
      { key: "headlines", storyIds: [6] },
      { key: "tools", storyIds: [7] },
    ],
    leadStoryId: 6,
    stories: [],
    excluded: [],
  },
};

const ACTIONS = [
  { outlineId: 11n, action: "exclude", reasonCode: "promo" },
  { outlineId: 11n, action: "move", reasonCode: "wrong section" },
  { outlineId: 11n, action: "add", reasonCode: null },
  { outlineId: 11n, action: "lead", reasonCode: "bigger story" },
  { outlineId: 12n, action: "link", reasonCode: null },
];

describe("summarizeFeedback", () => {
  it("counts, for each date, the stories proposed, kept in place, excluded, added and moved, and a lead change", () => {
    const { days } = summarizeFeedback([TUESDAY, MONDAY], ACTIONS);

    expect(days).toEqual([
      { date: "2099-01-06", proposed: 2, keptInPlace: 2, excluded: 0, added: 0, moved: 0, leadChanged: false },
      { date: "2099-01-05", proposed: 4, keptInPlace: 2, excluded: 1, added: 1, moved: 1, leadChanged: true },
    ]);
  });

  it("gives, for each section, how many proposals were kept in place over the period, as a share", () => {
    const { sections } = summarizeFeedback([TUESDAY, MONDAY], ACTIONS);

    expect(sections).toEqual([
      { key: "headlines", label: "Top Stories", proposed: 3, keptInPlace: 2, share: 67 },
      { key: "tools", label: "Tools", proposed: 3, keptInPlace: 2, share: 67 },
    ]);
  });

  it("counts the reason codes by action, most used first, and leaves out actions with no code", () => {
    const actions = [...ACTIONS, { outlineId: 12n, action: "exclude", reasonCode: "promo" }, { outlineId: 12n, action: "exclude", reasonCode: "repeat" }];

    expect(summarizeFeedback([TUESDAY, MONDAY], actions).reasons).toEqual([
      { action: "exclude", code: "promo", count: 2 },
      { action: "exclude", code: "repeat", count: 1 },
      { action: "lead", code: "bigger story", count: 1 },
      { action: "move", code: "wrong section", count: 1 },
    ]);
  });

  it("counts a restored repeat as added, and skips a proposed board it cannot read", () => {
    const broken = { ...TUESDAY, id: 13n, issueDate: new Date("2099-01-07T00:00:00Z"), proposed: "not a board" };
    const { days } = summarizeFeedback([broken, MONDAY], [{ outlineId: 11n, action: "restore_repeat", reasonCode: null }]);

    expect(days.map((day) => [day.date, day.added])).toEqual([["2099-01-05", 1]]);
  });
});

describe("readFeedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the newest outline with a proposed board for each issue date, and the actions of those outlines only", async () => {
    prismaMock.approvalOutline.findMany.mockResolvedValue([TUESDAY, MONDAY]);
    prismaMock.boardAction.findMany.mockResolvedValue(ACTIONS);

    const summary = await readFeedback();

    const query = prismaMock.approvalOutline.findMany.mock.calls[0][0];
    expect(query.distinct).toEqual(["issueDate"]);
    expect(query.orderBy).toEqual([{ issueDate: "desc" }, { committedAt: "desc" }]);
    expect(query.where.proposed).toBeDefined();
    expect(prismaMock.boardAction.findMany.mock.calls[0][0].where).toEqual({ outlineId: { in: [12n, 11n] } });
    expect(summary.days).toHaveLength(2);
  });

  it("keeps the last 30 issue dates", async () => {
    const outlines = Array.from({ length: FEEDBACK_DAYS + 5 }, (_, index) => ({
      ...TUESDAY,
      id: BigInt(100 + index),
      issueDate: new Date(Date.UTC(2099, 0, 31 - index)),
    }));
    prismaMock.approvalOutline.findMany.mockResolvedValue(outlines);
    prismaMock.boardAction.findMany.mockResolvedValue([]);

    const summary = await readFeedback();

    expect(FEEDBACK_DAYS).toBe(30);
    expect(summary.days).toHaveLength(30);
    expect(prismaMock.boardAction.findMany.mock.calls[0][0].where.outlineId.in).toHaveLength(30);
  });

  it("reads no actions when no commit has a proposed board", async () => {
    prismaMock.approvalOutline.findMany.mockResolvedValue([]);

    expect(await readFeedback()).toEqual({ days: [], sections: [], reasons: [] });
    expect(prismaMock.boardAction.findMany).not.toHaveBeenCalled();
  });
});
