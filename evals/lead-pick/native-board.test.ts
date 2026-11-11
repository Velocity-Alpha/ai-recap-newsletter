import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));
vi.mock("@/src/server/observability", () => ({ logServerInfo: vi.fn(), logServerError: vi.fn() }));

import { archiveJson, nativeBoard, type NativeCommit, type PoolRow } from "@/evals/lead-pick/native-board";

const FIXTURE = join("src", "features", "newsletter", "__fixtures__", "archived-boards.json");

const row = (id: number, fields: Partial<PoolRow> = {}): PoolRow => ({
  id,
  guid: null,
  day: "2026-11-09",
  headline: `Made-up headline ${id}`,
  summary: "",
  story_details: "",
  category: "Launches",
  source: "tldr",
  url: `https://example.com/story-${id}`,
  importance_score: 3,
  paywall_detected: "unknown",
  ...fields,
});

const COMMIT: NativeCommit = {
  date: "2026-11-09",
  leadStoryId: 1,
  sections: [
    { key: "headlines", storyIds: [1, 2] },
    { key: "tools", storyIds: [3] },
  ],
};

describe("archiveJson", () => {
  it("writes the fixture in its own layout, so a rebuild changes only the boards it adds", () => {
    const text = readFileSync(FIXTURE, "utf8");
    expect(archiveJson(JSON.parse(text))).toBe(text);
  });
});

describe("nativeBoard", () => {
  it("keeps the committed lead and the approved count, with no removals stored", () => {
    const board = nativeBoard(COMMIT, [row(1, { importance_score: 5 }), row(2), row(3, { category: "Tools" })], new Set());
    expect(board).toMatchObject({ date: "2026-11-09", lead_id: 1, approved_count: 3, removed_ids: [] });
    expect(board.ranked_pool[0]).toEqual({
      id: 1,
      category: "Launches",
      importance: 5,
      sources: ["tldr"],
      headline: "Made-up headline 1",
      paywall: "unknown",
    });
  });

  it("ranks the pool by the board's ranking", () => {
    const board = nativeBoard(COMMIT, [row(2, { importance_score: 2 }), row(1, { importance_score: 5 })], new Set());
    expect(board.ranked_pool.map((story) => story.id)).toEqual([1, 2]);
  });

  it("drops a guid copy, keeping the first one read", () => {
    const board = nativeBoard(COMMIT, [row(1, { guid: "g" }), row(2, { guid: "g" })], new Set());
    expect(board.ranked_pool.map((story) => story.id)).toEqual([1]);
  });

  it("drops a story whose URL ran in an earlier issue", () => {
    const board = nativeBoard(COMMIT, [row(1), row(2)], new Set(["https://example.com/story-2"]));
    expect(board.ranked_pool.map((story) => story.id)).toEqual([1]);
  });

  it("drops a same-URL copy and credits its newsletter to the story kept", () => {
    const board = nativeBoard(COMMIT, [row(1, { importance_score: 5 }), row(2, { url: "https://example.com/story-1", source: "the_signal" })], new Set());
    expect(board.ranked_pool).toHaveLength(1);
    expect(board.ranked_pool[0].sources).toEqual(["the_signal", "tldr"]);
  });

  it("refuses a commit whose lead is not in the rebuilt pool", () => {
    expect(() => nativeBoard(COMMIT, [row(2)], new Set())).toThrow(/not in the rebuilt pool/);
  });
});
