import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyRepeatRules, pairLevel, type RepeatReference, type StoryMatchRow } from "@/src/pipeline/repeats/repeat-rules";

/** Recorded answers on real stories (__fixtures__/README.md). No network. The numbers are exact. */

function readJsonl<T>(name: string): T[] {
  return readFileSync(join(__dirname, "__fixtures__", name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

interface FixtureStory {
  id: number;
  day: string;
  headline: string;
  importance: number;
  published_on: string | null;
}
interface JudgedPair {
  newer: number;
  older: number;
  similarity: number;
  same: number;
  news: number;
}
interface LabelledPair {
  label: "same" | "follow_up" | "different";
  same: number;
  news: number;
}
interface Block {
  groups: number[][];
}

const stories = readJsonl<FixtureStory>("stories.jsonl");
const judged = readJsonl<JudgedPair>("judged-pairs.jsonl");
const matches: StoryMatchRow[] = judged.map((pair) => ({
  newerStoryId: pair.newer,
  olderStoryId: pair.older,
  similarity: pair.similarity,
  same: pair.same,
  news: pair.news,
}));

function count<T>(items: T[], test: (item: T) => boolean) {
  return items.filter(test).length;
}

describe("labelled pairs", () => {
  const labelled = readJsonl<LabelledPair>("labelled-pairs.jsonl");
  const withLabel = (label: LabelledPair["label"]) => labelled.filter((pair) => pair.label === label);

  it("matches the measured levels", () => {
    const same = withLabel("same");
    expect(same).toHaveLength(113);
    expect(count(same, (pair) => pairLevel(pair) === "sure")).toBe(82);
    expect(count(same, (pair) => pairLevel(pair) !== null)).toBe(108);
    expect(withLabel("different")).toHaveLength(118);
    expect(count(withLabel("different"), (pair) => pairLevel(pair) === "sure")).toBe(0);
    expect(withLabel("follow_up")).toHaveLength(12);
    expect(count(withLabel("follow_up"), (pair) => pairLevel(pair) === "sure")).toBe(2);
  });
});

describe("blocks", () => {
  it("finds the same-news pairs inside each group", () => {
    const byKey = new Map(judged.map((pair) => [`${Math.min(pair.newer, pair.older)}-${Math.max(pair.newer, pair.older)}`, pair]));
    const levels: (string | null)[] = [];
    for (const block of readJsonl<Block>("blocks.jsonl")) {
      for (const group of block.groups) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const pair = byKey.get(`${Math.min(group[i], group[j])}-${Math.max(group[i], group[j])}`);
            levels.push(pair ? pairLevel(pair) : null);
          }
        }
      }
    }
    expect(levels).toHaveLength(250);
    expect(count(levels, (level) => level === "sure")).toBe(184);
    expect(count(levels, (level) => level !== null)).toBe(244);
  });
});

describe("board replay", () => {
  const DAY = 86_400_000;
  const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

  function replay(boardDate: string) {
    const earliest = shift(boardDate, -3);
    const candidates = stories
      .filter((story) => story.day >= earliest && story.day <= boardDate)
      .filter((story) => story.importance >= 2)
      .filter((story) => story.published_on === null || story.published_on >= boardDate)
      .sort((a, b) => b.importance - a.importance || b.id - a.id);
    const windowStart = shift(boardDate, -14);
    const references = new Map<number, RepeatReference>();
    for (const story of stories) {
      if (story.published_on && story.published_on >= windowStart && story.published_on < boardDate) {
        references.set(story.id, { headline: story.headline, date: story.published_on, kind: "published" });
      }
    }
    return applyRepeatRules({ candidates, matches, references, excluded: new Map() });
  }

  const removed = (board: ReturnType<typeof replay>, id: number) => board.removed.find((entry) => entry.story.id === id)?.repeatOf.id;
  const mergedInto = (board: ReturnType<typeof replay>, id: number) => board.merged.find((entry) => entry.story.id === id)?.into;
  const head = (board: ReturnType<typeof replay>, id: number) => board.heads.some((story) => story.id === id);

  it.each([
    [10776, "2026-10-27", 10704],
    [10773, "2026-10-30", 10782],
    [10845, "2026-10-29", 10822],
    [10897, "2026-10-30", 10864],
    [10951, "2026-11-02", 10782],
    [10989, "2026-11-03", 10782],
  ])("removes %i on %s as a repeat of %i", (story, date, repeatOf) => {
    expect(removed(replay(date), story)).toBe(repeatOf);
  });

  it.each([
    [10952, "2026-11-02", 10956],
    [10955, "2026-11-03", 11004],
  ])("merges %i on %s into %i", (story, date, into) => {
    expect(mergedInto(replay(date), story)).toBe(into);
  });

  it("keeps 10956 on 2026-11-02 with a label for 10864", () => {
    const board = replay("2026-11-02");
    expect(head(board, 10956)).toBe(true);
    expect(board.similarTo.get(10956)?.map((entry) => entry.id)).toContain(10864);
  });

  it.each([
    [10630, "2026-10-22"],
    [10743, "2026-10-27"],
  ])("keeps %i on %s with no label", (story, date) => {
    const board = replay(date);
    expect(head(board, story)).toBe(true);
    expect(board.similarTo.has(story)).toBe(false);
  });

  it("removes 4 and merges 3 on 2026-11-03", () => {
    const board = replay("2026-11-03");
    expect(board.removed).toHaveLength(4);
    expect(board.merged).toHaveLength(3);
  });
});
