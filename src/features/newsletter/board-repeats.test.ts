import { beforeEach, describe, expect, it, vi } from "vitest";

type Match = { newerStoryId: number; olderStoryId: number; similarity: number; same: number; news: number };
type Row = { id: number; headline: string; usedInPublicationDate: Date | null; excludeFromCandidates: boolean; excludedOn: Date | null };

const db = vi.hoisted(() => ({ matches: [] as Match[], stories: [] as Row[] }));

vi.mock("@/src/server/prisma", () => ({
  prisma: {
    storyMatch: {
      findMany: vi.fn(async ({ where }: { where: { OR: [{ newerStoryId: { in: number[] } }, { olderStoryId: { in: number[] } }] } }) => {
        const ids = new Set(where.OR[0].newerStoryId.in);
        return db.matches.filter((m) => ids.has(m.newerStoryId) || ids.has(m.olderStoryId));
      }),
    },
    story: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) => db.stories.filter((row) => where.id.in.includes(row.id))),
    },
  },
}));
vi.mock("@/src/server/observability", () => ({ logServerInfo: vi.fn(), logServerError: vi.fn() }));
vi.mock("@/src/pipeline/repeats/repeats-store", () => ({ readRepeatWindowDays: vi.fn(async () => 14) }));

import { applyBoardRepeats, type BoardStory } from "@/src/features/newsletter/board-repeats";
import type { RepeatCheck } from "@/src/pipeline/repeats/repeat-check";

const DATE = "2026-11-10";
const SURE = { same: 0.95, news: 0.05 };
const SIMILAR = { same: 0.6, news: 0.2 };

function match(newer: number, older: number, level: { same: number; news: number }): Match {
  return { newerStoryId: newer, olderStoryId: older, similarity: 0.8, ...level };
}
function story(id: number, extra: Partial<BoardStory> = {}): BoardStory {
  return { id, source: `source${id}`, headline: `Story ${id}`, url: `https://example.org/${id}`, paywall_detected: "no", ...extra };
}
function published(id: number, day: string): Row {
  return { id, headline: `Published ${id}`, usedInPublicationDate: new Date(`${day}T00:00:00Z`), excludeFromCandidates: false, excludedOn: null };
}

const noCheck: RepeatCheck = async (ids) => ({ checked: ids.length, embedded: 0, judged: 0, pairs: 0, refused: 0 });

beforeEach(() => {
  db.matches = [];
  db.stories = [];
});

describe("applyBoardRepeats", () => {
  it("checks the candidates first, then removes a sure repeat of a published story", async () => {
    db.matches = [match(1, 100, SURE)];
    db.stories = [published(100, "2026-11-06")];
    const check = vi.fn(noCheck);
    const result = await applyBoardRepeats({ date: DATE, candidates: [story(1), story(2)], held: [] }, { check });

    expect(check).toHaveBeenCalledWith([1, 2]);
    expect(result.heads.map((s) => s.id)).toEqual([2]);
    expect(result.repeatsRemoved).toEqual([
      { story: story(1), repeat_of: { id: 100, headline: "Published 100", date: "2026-11-06", kind: "published" } },
    ]);
    expect(result.incomplete).toBe(false);
  });

  it("does nothing for a story published before the window, or on the board date", async () => {
    db.matches = [match(1, 100, SURE), match(2, 101, SURE)];
    db.stories = [published(100, "2026-10-26"), published(101, DATE)];
    const result = await applyBoardRepeats({ date: DATE, candidates: [story(1), story(2)], held: [] }, { check: noCheck });
    expect(result.heads.map((s) => s.id)).toEqual([1, 2]);
    expect(result.repeatsRemoved).toEqual([]);
  });

  it("removes a sure repeat of a held story, with the draft's date", async () => {
    db.matches = [match(1, 50, SURE)];
    db.stories = [{ id: 50, headline: "Held", usedInPublicationDate: null, excludeFromCandidates: false, excludedOn: null }];
    const result = await applyBoardRepeats(
      { date: DATE, candidates: [story(1)], held: [{ id: 50, headline: "In the draft", held_for_date: "2026-11-09" }] },
      { check: noCheck },
    );
    expect(result.repeatsRemoved[0].repeat_of).toEqual({ id: 50, headline: "In the draft", date: "2026-11-09", kind: "held" });
  });

  it("merges a duplicate into the higher-ranked story, with its sources and an also_from entry", async () => {
    db.matches = [match(2, 1, SURE)];
    const result = await applyBoardRepeats(
      { date: DATE, candidates: [story(1, { sources: ["a", "source1"] }), story(2, { paywall_detected: "yes" })], held: [] },
      { check: noCheck },
    );
    expect(result.heads).toHaveLength(1);
    expect(result.heads[0].sources).toEqual(["a", "source1", "source2"]);
    expect(result.heads[0].also_from).toEqual([
      { id: 2, source: "source2", headline: "Story 2", url: "https://example.org/2", paywall_detected: "yes" },
    ]);
  });

  it("labels a similar story, and a chain through a story the matches reach", async () => {
    // 1 is similar to published 100. 2 looks like 60, and 60 is a sure repeat of published 101.
    db.matches = [match(1, 100, SIMILAR), match(2, 60, SIMILAR), match(60, 101, SURE)];
    db.stories = [
      published(100, "2026-11-05"),
      published(101, "2026-11-04"),
      { id: 60, headline: "Other", usedInPublicationDate: null, excludeFromCandidates: false, excludedOn: null },
    ];
    const result = await applyBoardRepeats({ date: DATE, candidates: [story(1), story(2)], held: [] }, { check: noCheck });
    expect(result.heads.find((s) => s.id === 1)?.similar_to).toEqual([{ kind: "published", id: 100, headline: "Published 100", date: "2026-11-05" }]);
    expect(result.heads.find((s) => s.id === 2)?.similar_to).toEqual([{ kind: "published", id: 101, headline: "Published 101", date: "2026-11-04" }]);
  });

  it("labels a pair to an excluded story with the date it was excluded", async () => {
    db.matches = [match(1, 70, SURE)];
    db.stories = [{ id: 70, headline: "Excluded", usedInPublicationDate: null, excludeFromCandidates: true, excludedOn: new Date("2026-11-07T00:00:00Z") }];
    const result = await applyBoardRepeats({ date: DATE, candidates: [story(1)], held: [] }, { check: noCheck });
    expect(result.heads[0].similar_to).toEqual([{ kind: "excluded", id: 70, headline: "Excluded", date: "2026-11-07" }]);
  });

  it("says the check is incomplete when it throws or a request failed, and still uses the stored matches", async () => {
    db.matches = [match(1, 100, SURE)];
    db.stories = [published(100, "2026-11-06")];
    const throwing: RepeatCheck = async () => {
      throw new Error("OpenAI down");
    };
    const failing: RepeatCheck = async (ids) => ({ ...(await noCheck(ids)), failed: { count: 1, firstError: "HTTP 500" } });

    for (const check of [throwing, failing]) {
      const result = await applyBoardRepeats({ date: DATE, candidates: [story(1)], held: [] }, { check });
      expect(result.incomplete).toBe(true);
      expect(result.repeatsRemoved).toHaveLength(1);
    }
  });

  it("does nothing for an empty board", async () => {
    const check = vi.fn(noCheck);
    await expect(applyBoardRepeats({ date: DATE, candidates: [], held: [] }, { check })).resolves.toEqual({
      heads: [],
      repeatsRemoved: [],
      incomplete: false,
    });
    expect(check).not.toHaveBeenCalled();
  });
});
