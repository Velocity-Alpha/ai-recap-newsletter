import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  pipelineRun: { findFirst: vi.fn() },
  story: { groupBy: vi.fn(), aggregate: vi.fn() },
  issue: { aggregate: vi.fn(), findMany: vi.fn() },
  skippedDate: { findUnique: vi.fn() },
}));
const settings = vi.hoisted(() => new Map<string, unknown>());

const staged = vi.hoisted(() => ({ readDateIssueFacts: vi.fn() }));

vi.mock("@/src/server/prisma", () => ({ prisma: db }));
vi.mock("@/src/pipeline/distribution/issue-state-store", () => staged);
vi.mock("@/src/pipeline/settings", () => ({ readSetting: vi.fn(async (key: string) => settings.get(key) ?? null) }));

import { readDayFacts } from "@/src/pipeline/checks/day-facts";

const day = (date: string) => new Date(`${date}T00:00:00Z`);
const TODAY_START = "2026-11-10T05:00:00.000Z";
const TODAY_BY_SOURCE = [
  { source: "tldr", _count: { _all: 16 } },
  { source: "rundown_ai", _count: { _all: 14 } },
  { source: null, _count: { _all: 1 } },
];
// Stories by source on earlier Tuesdays, keyed by the start of that New York day.
const HISTORY: Record<string, Array<{ source: string | null; _count: { _all: number } }>> = {
  "2026-11-03T05:00:00.000Z": [
    { source: "tldr", _count: { _all: 50 } },
    { source: "rundown_ai", _count: { _all: 30 } },
  ],
  "2026-10-27T04:00:00.000Z": [{ source: "tldr", _count: { _all: 76 } }],
};

function groupBySource(byStart: Record<string, unknown[]>) {
  return async ({ where }: { where: { createdAt: { gte: Date } } }) => byStart[where.createdAt.gte.toISOString()] ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.clear();
  db.skippedDate.findUnique.mockResolvedValue(null);
  staged.readDateIssueFacts.mockResolvedValue({ published: false, newestDraft: null, newestStaged: null });
  db.pipelineRun.findFirst.mockResolvedValue({ id: 41n, status: "succeeded", startedAt: new Date("2026-11-10T14:55:00Z") });
  db.story.groupBy.mockImplementation(groupBySource({ [TODAY_START]: TODAY_BY_SOURCE, ...HISTORY }));
  db.story.aggregate.mockResolvedValue({ _count: { _all: 23 }, _min: { updatedAt: new Date("2026-11-10T16:52:00Z") } });
  db.issue.aggregate.mockResolvedValue({ _count: { _all: 2 }, _min: { createdAt: new Date("2026-11-10T16:48:00Z") } });
  db.issue.findMany.mockResolvedValue([
    { id: 271n, slug: "second-draft", title: "Second draft", status: "draft", publishedAt: null },
    { id: 270n, slug: "first-draft", title: "First draft", status: "published", publishedAt: new Date("2026-11-10T17:31:00Z") },
  ]);
});

describe("readDayFacts", () => {
  it("reads one New York date from the existing tables", async () => {
    await expect(readDayFacts("2026-11-10")).resolves.toEqual({
      date: "2026-11-10",
      weekday: "Tue",
      skipped: null,
      ingestRun: { id: "41", status: "succeeded", startedAt: new Date("2026-11-10T14:55:00Z") },
      storiesBySource: { tldr: 16, rundown_ai: 14, unknown: 1 },
      storyTotal: 31,
      weekdayTotals: [80, 76],
      queuedStories: 23,
      committed: true,
      // The first draft row is older than the queued stories' last touch, so it is the better estimate.
      commitTime: new Date("2026-11-10T16:48:00Z"),
      draftsMade: 2,
      draftReady: true,
      // The published draft wins over a later unpublished one.
      issue: { id: "270", slug: "first-draft", title: "First draft", status: "published", publishedAt: new Date("2026-11-10T17:31:00Z") },
      stagedVersion: null,
      changedSinceStaged: false,
      warnings: [],
    });
  });

  it("gives the newest staged version and whether the draft changed after it", async () => {
    const draft = { id: 41, status: "ready", title: "Pretend Lab Plans A Week", featuredImageUrl: null };
    staged.readDateIssueFacts.mockResolvedValue({
      published: false,
      newestDraft: draft,
      newestStaged: { version: 2, draftId: 41, title: draft.title, featuredImageUrl: null },
    });
    await expect(readDayFacts("2026-11-10")).resolves.toMatchObject({ stagedVersion: 2, changedSinceStaged: false });
    expect(staged.readDateIssueFacts).toHaveBeenCalledWith("2026-11-10");

    staged.readDateIssueFacts.mockResolvedValue({
      published: false,
      newestDraft: { ...draft, title: "Pretend Lab Plans A Month" },
      newestStaged: { version: 2, draftId: 41, title: draft.title, featuredImageUrl: null },
    });
    await expect(readDayFacts("2026-11-10")).resolves.toMatchObject({ stagedVersion: 2, changedSinceStaged: true });
  });

  it("counts the date as not staged when the staged versions cannot be read, and says why", async () => {
    staged.readDateIssueFacts.mockRejectedValue(new Error('relation "newsletter.staged_versions" does not exist'));

    await expect(readDayFacts("2026-11-10")).resolves.toMatchObject({
      stagedVersion: null,
      changedSinceStaged: false,
      draftReady: true,
      warnings: ['Could not read the staged versions, so 2026-11-10 counts as not staged: relation "newsletter.staged_versions" does not exist'],
    });
  });

  it("counts the date as not skipped when skipped_dates cannot be read, and says why", async () => {
    db.skippedDate.findUnique.mockRejectedValue(new Error('relation "newsletter.skipped_dates" does not exist'));

    await expect(readDayFacts("2026-11-10")).resolves.toMatchObject({
      skipped: null,
      storyTotal: 31,
      warnings: [
        'Could not read skipped_dates, so 2026-11-10 counts as not skipped: relation "newsletter.skipped_dates" does not exist',
      ],
    });
  });

  it("counts stories and the ingest run by New York ingest time, and history on the same weekday", async () => {
    await readDayFacts("2026-11-10");

    const today = { gte: new Date("2026-11-10T05:00:00Z"), lt: new Date("2026-11-11T05:00:00Z") };
    expect(db.pipelineRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { job: "ingest-stories", startedAt: today } }),
    );
    expect(db.story.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ["source"], where: { createdAt: today } }));
    // Today, then 8 earlier Tuesdays; the ones in October and September are in daylight time.
    const windows = db.story.groupBy.mock.calls.map(([args]) => args.where.createdAt.gte.toISOString());
    expect(windows).toEqual([
      TODAY_START,
      "2026-11-03T05:00:00.000Z",
      "2026-10-27T04:00:00.000Z",
      "2026-10-20T04:00:00.000Z",
      "2026-10-13T04:00:00.000Z",
      "2026-10-06T04:00:00.000Z",
      "2026-09-29T04:00:00.000Z",
      "2026-09-22T04:00:00.000Z",
      "2026-09-15T04:00:00.000Z",
    ]);
    expect(db.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { issueDate: day("2026-11-10"), html: { not: null } } }),
    );
  });

  it("reads an empty day and a skipped date", async () => {
    db.skippedDate.findUnique.mockResolvedValue({
      date: day("2026-11-10"),
      note: null,
      createdBy: "approval",
      createdAt: new Date("2026-11-10T13:00:00Z"),
    });
    db.pipelineRun.findFirst.mockResolvedValue(null);
    db.story.groupBy.mockResolvedValue([]);
    db.story.aggregate.mockResolvedValue({ _count: { _all: 0 }, _min: { updatedAt: null } });
    db.issue.aggregate.mockResolvedValue({ _count: { _all: 0 }, _min: { createdAt: null } });
    db.issue.findMany.mockResolvedValue([]);

    await expect(readDayFacts("2026-11-10")).resolves.toMatchObject({
      skipped: { note: null, createdAt: new Date("2026-11-10T13:00:00Z") },
      ingestRun: null,
      storiesBySource: {},
      storyTotal: 0,
      weekdayTotals: [],
      queuedStories: 0,
      committed: false,
      commitTime: null,
      draftsMade: 0,
      draftReady: false,
      issue: null,
    });
  });

  it("counts a draft without queued stories as a commit", async () => {
    db.story.aggregate.mockResolvedValue({ _count: { _all: 0 }, _min: { updatedAt: null } });
    db.issue.aggregate.mockResolvedValue({ _count: { _all: 1 }, _min: { createdAt: new Date("2026-11-10T16:48:00Z") } });
    db.issue.findMany.mockResolvedValue([]);

    await expect(readDayFacts("2026-11-10")).resolves.toMatchObject({
      committed: true,
      commitTime: new Date("2026-11-10T16:48:00Z"),
      draftReady: false,
      issue: null,
    });
  });
});
