import { describe, expect, it, vi } from "vitest";
import type { JudgePairs } from "@/src/pipeline/repeats/decisions";
import { matchStories, type MatchStory, type RepeatsStore } from "@/src/pipeline/repeats/match-stories";
import type { StoryMatchRow } from "@/src/pipeline/repeats/repeat-rules";

/** A unit vector at `degrees` from [1, 0]. */
function at(degrees: number): number[] {
  const radians = (degrees * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}

function story(id: number, day: string, angle: number | null): MatchStory & { angle: number | null } {
  return { id, day, headline: angle === null ? null : `H${id}`, summary: `S${id}`, angle };
}

function fakeStore(stories: ReturnType<typeof story>[], options: { embedded?: number[]; matches?: StoryMatchRow[] } = {}) {
  const embeddings = new Map<number, number[]>();
  for (const id of options.embedded ?? []) embeddings.set(id, at(stories.find((s) => s.id === id)!.angle!));
  const matches: StoryMatchRow[] = [...(options.matches ?? [])];
  const matched = new Set<number>();
  const saveEmbeddings = vi.fn(async (rows: { storyId: number; vector: number[] }[]) => {
    for (const row of rows) embeddings.set(row.storyId, row.vector);
  });
  const store: RepeatsStore = {
    loadUnmatched: async (ids) => stories.filter((s) => ids.includes(s.id) && !matched.has(s.id)),
    loadStoriesByDay: async (from, to) => stories.filter((s) => s.day >= from && s.day <= to),
    loadEmbeddings: async (ids) => ids.filter((id) => embeddings.has(id)).map((id) => ({ storyId: id, vector: embeddings.get(id)! })),
    saveEmbeddings,
    loadMatchedPairs: async (ids) =>
      matches.filter((m) => ids.includes(m.newerStoryId) || ids.includes(m.olderStoryId)).map((m) => [m.newerStoryId, m.olderStoryId]),
    saveMatches: async (rows) => {
      matches.push(...rows);
    },
    markMatched: async (ids) => {
      for (const id of ids) matched.add(id);
    },
  };
  return { store, matches, matched, saveEmbeddings };
}

/** Embeds `H<id>\nS<id>` as the vector of story <id>. */
function fakeEmbed(stories: ReturnType<typeof story>[]) {
  return vi.fn(async (texts: string[]) =>
    texts.map((text) => at(stories.find((s) => text === `H${s.id}\nS${s.id}`)!.angle!)),
  );
}

const sameNews: JudgePairs = async (_newer, olders) => olders.map((older) => ({ olderId: older.id, same: 0.95, news: 0.05 }));

const STORIES = [
  story(1, "2026-11-01", 0),
  story(2, "2026-11-09", 5), // close to 1
  story(3, "2026-11-10", 10), // close to 1 and 2
  story(4, "2026-11-10", 90), // close to nothing
  story(5, "2026-10-20", 1), // close, but more than 14 days before 3
  story(6, "2026-11-10", null), // no headline
];

describe("matchStories", () => {
  it("embeds only stories without an embedding, judges each new pair once, and sets matched_at", async () => {
    const { store, matches, matched, saveEmbeddings } = fakeStore(STORIES, { embedded: [1] });
    const embed = fakeEmbed(STORIES);
    const judge = vi.fn(sameNews);

    const counts = await matchStories([3, 4, 6], { store, embed, judge, windowDays: 14 });

    // Pool: 2026-10-27 to 2026-11-10, with text: 1, 2, 3, 4. Story 1 had an embedding.
    expect(saveEmbeddings.mock.calls[0][0].map((row: { storyId: number }) => row.storyId)).toEqual([2, 3, 4]);
    expect(embed).toHaveBeenCalledTimes(1);
    // Story 3 pairs with 2 and 1; it is the newer side of both: one request.
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0][0]).toEqual({ id: 3, headline: "H3", summary: "S3" });
    expect(judge.mock.calls[0][1].map((older) => older.id)).toEqual([2, 1]);
    expect(matches.map((m) => [m.newerStoryId, m.olderStoryId])).toEqual([
      [3, 2],
      [3, 1],
    ]);
    expect(matches[0]).toMatchObject({ same: 0.95, news: 0.05 });
    expect(matches[0].similarity).toBeCloseTo(Math.cos((5 * Math.PI) / 180));
    expect([...matched].sort()).toEqual([3, 4, 6]);
    expect(counts).toEqual({ embedded: 3, judged: 1, pairs: 2, refused: 0 });
  });

  it("never judges a stored pair again", async () => {
    const { store } = fakeStore(STORIES, {
      embedded: [1, 2, 3, 4],
      matches: [{ newerStoryId: 3, olderStoryId: 2, similarity: 0.99, same: 0.9, news: 0.1 }],
    });
    const judge = vi.fn(sameNews);
    const counts = await matchStories([3], { store, embed: fakeEmbed(STORIES), judge, windowDays: 14 });
    expect(judge.mock.calls[0][1].map((older) => older.id)).toEqual([1]);
    expect(counts).toEqual({ embedded: 0, judged: 1, pairs: 1, refused: 0 });
  });

  it("asks the newer side, so an older given story's pair goes in the newer story's request", async () => {
    const { store, matches } = fakeStore(STORIES, { embedded: [1, 2, 3, 4] });
    const judge = vi.fn(sameNews);
    await matchStories([2, 3], { store, embed: fakeEmbed(STORIES), judge, windowDays: 14 });
    // 2~1 (newer 2), 3~2 and 3~1 (newer 3). The pair 2~3 is found twice but judged once.
    expect(judge.mock.calls.map(([newer, olders]) => [newer.id, olders.map((older) => older.id)])).toEqual([
      [2, [1]],
      [3, [2, 1]],
    ]);
    expect(matches).toHaveLength(3);
  });

  it("counts refused pairs and stores no row for them", async () => {
    const { store, matches } = fakeStore(STORIES, { embedded: [1, 2, 3, 4] });
    const judge: JudgePairs = async (_newer, olders) => [{ olderId: olders[0].id, same: 0.1, news: 0.9 }];
    const counts = await matchStories([3], { store, embed: fakeEmbed(STORIES), judge, windowDays: 14 });
    expect(counts).toMatchObject({ pairs: 1, refused: 1 });
    expect(matches).toHaveLength(1);
  });

  it("leaves matched_at null for a story whose request failed, and goes on with the others", async () => {
    const stories = [...STORIES, story(7, "2026-11-10", 92)];
    const { store, matched, matches } = fakeStore(stories, { embedded: [1, 2, 3, 4, 7] });
    const onJudgeError = vi.fn();
    const judge: JudgePairs = async (newer, olders) => {
      if (newer.id === 3) throw new Error("HTTP 500");
      return sameNews(newer, olders);
    };
    const counts = await matchStories([3, 7], { store, embed: fakeEmbed(stories), judge, windowDays: 14, onJudgeError });
    expect([...matched]).toEqual([7]);
    expect(matches.map((m) => [m.newerStoryId, m.olderStoryId])).toEqual([[7, 4]]);
    expect(onJudgeError).toHaveBeenCalledWith(3, expect.any(Error));
    expect(counts).toEqual({ embedded: 0, judged: 1, pairs: 1, refused: 0 });
  });

  it("returns zeros when every given story was checked", async () => {
    const { store } = fakeStore(STORIES);
    await store.markMatched([3], new Date());
    const judge = vi.fn(sameNews);
    await expect(matchStories([3], { store, embed: fakeEmbed(STORIES), judge, windowDays: 14 })).resolves.toEqual({
      embedded: 0,
      judged: 0,
      pairs: 0,
      refused: 0,
    });
    expect(judge).not.toHaveBeenCalled();
  });

  it("runs at most 6 requests at the same time", async () => {
    const many = Array.from({ length: 20 }, (_, index) => story(100 + index, "2026-11-10", index * 0.1));
    const { store } = fakeStore(many, { embedded: many.map((s) => s.id) });
    let running = 0;
    let most = 0;
    const judge: JudgePairs = async (newer, olders) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return sameNews(newer, olders);
    };
    await matchStories(many.map((s) => s.id), { store, embed: fakeEmbed(many), judge, windowDays: 14 });
    expect(most).toBe(6);
  });
});
