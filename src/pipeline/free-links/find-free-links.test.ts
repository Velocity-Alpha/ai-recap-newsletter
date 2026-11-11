import { describe, expect, it, vi } from "vitest";

import type { CheckedLink, LinkCandidate } from "@/src/pipeline/free-links/check-links";
import {
  describeFreeLinksRun,
  findFreeLinks,
  surePartners,
  type FreeLinkStory,
  type FreeLinksStore,
  type OwnStory,
  type SavedLink,
} from "@/src/pipeline/free-links/find-free-links";

const NOW = new Date("2026-11-10T12:00:00Z");

function story(id: number): FreeLinkStory {
  return { id, headline: `Headline ${id}`, summary: `Summary ${id}`, url: `https://www.wsj.com/story-${id}`, day: new Date("2026-11-09") };
}

function storeOf(stories: FreeLinkStory[], own: Record<number, OwnStory[]> = {}) {
  const saved = new Map<number, { links: SavedLink[]; at: Date }>();
  /** The stories a run works on now. */
  const claimed = new Set<number>();
  const free = (id: number) => !saved.has(id) && !claimed.has(id);
  const store: FreeLinksStore = {
    storiesToSearch: vi.fn(async (ids: number[]) => stories.filter((entry) => ids.includes(entry.id) && free(entry.id))),
    claim: vi.fn(async (storyId: number) => {
      if (!free(storyId)) return false;
      claimed.add(storyId);
      return true;
    }),
    release: vi.fn(async (storyId: number) => {
      claimed.delete(storyId);
    }),
    ownStories: vi.fn(async (entry: FreeLinkStory) => own[entry.id] ?? []),
    save: vi.fn(async (storyId: number, links: SavedLink[], at: Date) => {
      saved.set(storyId, { links, at });
    }),
  };
  return { store, saved, claimed };
}

/** A check that keeps every candidate whose link has `free` in it. */
const keepFree = vi.fn(async (_story: { id: number; url: string }, candidates: LinkCandidate[]): Promise<CheckedLink[]> =>
  candidates
    .filter((candidate) => candidate.url.includes("free"))
    .map((candidate) => ({ url: candidate.url, site: new URL(candidate.url).hostname, title: candidate.title ?? null, words: 500 })),
);

describe("findFreeLinks", () => {
  it("uses our own stories first, and does not search when one of them is a free link", async () => {
    const { store, saved } = storeOf([story(1)], { 1: [{ id: 9, url: "https://free.example/own", headline: "Own" }] });
    const search = vi.fn(async () => []);

    const result = await findFreeLinks([1], { store, search, checkLinks: keepFree, now: () => NOW });

    expect(search).not.toHaveBeenCalled();
    expect(saved.get(1)).toEqual({
      links: [{ url: "https://free.example/own", site: "free.example", title: "Own", words: 500, origin: "story", originStoryId: 9 }],
      at: NOW,
    });
    expect(result).toEqual({ stories: 1, fromStories: 1, searched: 0, links: 1, failed: 0 });
  });

  it("searches the web when no own story is a free link, and saves the links in order", async () => {
    const { store, saved } = storeOf([story(1)], { 1: [{ id: 9, url: "https://walled.example/own", headline: "Own" }] });
    const search = vi.fn(async () => [
      { url: "https://free.example/a", title: "A" },
      { url: "https://walled.example/b", title: "B" },
      { url: "https://free.example/c", title: "C" },
    ]);

    const result = await findFreeLinks([1], { store, search, checkLinks: keepFree, now: () => NOW });

    expect(search).toHaveBeenCalledWith(story(1));
    expect(saved.get(1)?.links).toEqual([
      { url: "https://free.example/a", site: "free.example", title: "A", words: 500, origin: "search", originStoryId: null },
      { url: "https://free.example/c", site: "free.example", title: "C", words: 500, origin: "search", originStoryId: null },
    ]);
    expect(result).toEqual({ stories: 1, fromStories: 0, searched: 1, links: 2, failed: 0 });
  });

  it("marks a story as searched also when it found no free link", async () => {
    const { store, saved } = storeOf([story(1)]);

    const result = await findFreeLinks([1], { store, search: async () => [], checkLinks: keepFree, now: () => NOW });

    expect(saved.get(1)).toEqual({ links: [], at: NOW });
    expect(result).toEqual({ stories: 1, fromStories: 0, searched: 1, links: 0, failed: 0 });
  });

  it("does nothing for a story that is not paywalled or was searched before", async () => {
    const { store } = storeOf([]);
    const search = vi.fn(async () => []);

    const result = await findFreeLinks([1, 2], { store, search, checkLinks: keepFree });

    expect(store.storiesToSearch).toHaveBeenCalledWith([1, 2], expect.any(Date));
    expect(search).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(result).toEqual({ stories: 0, fromStories: 0, searched: 0, links: 0, failed: 0 });
  });

  describe("when the web search fails for one story", () => {
    const failFirst = vi.fn(async (entry: { url: string }) => {
      if (entry.url.endsWith("story-1")) throw new Error("The web search is down.");
      return [{ url: "https://free.example/a", title: "A" }];
    });

    it("logs the error with the story's id", async () => {
      const log = vi.fn();

      await findFreeLinks([1, 2], { store: storeOf([story(1), story(2)]).store, search: failFirst, checkLinks: keepFree, log });

      expect(log).toHaveBeenCalledWith(expect.stringMatching(/Story 1: The web search is down\./));
    });

    it("leaves the story not searched and gives it back, so the next run can search it", async () => {
      const { store, saved, claimed } = storeOf([story(1), story(2)]);

      await findFreeLinks([1, 2], { store, search: failFirst, checkLinks: keepFree, log: vi.fn() });

      expect(saved.has(1)).toBe(false);
      expect(claimed.has(1)).toBe(false);
    });

    it("goes on with the other stories, and counts the failure", async () => {
      const { store, saved } = storeOf([story(1), story(2)]);

      const result = await findFreeLinks([1, 2], { store, search: failFirst, checkLinks: keepFree, log: vi.fn() });

      expect(saved.get(2)?.links).toHaveLength(1);
      expect(result).toEqual({ stories: 2, fromStories: 0, searched: 2, links: 1, failed: 1 });
    });
  });

  it("counts a story as failed when its links cannot be checked", async () => {
    const { store, saved } = storeOf([story(1)]);
    const checkLinks = vi.fn(async () => Promise.reject(new Error("The reader broke.")));
    const log = vi.fn();

    const result = await findFreeLinks([1], { store, search: async () => [], checkLinks, log });

    expect(saved.has(1)).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Story 1: The reader broke."));
    expect(result).toMatchObject({ stories: 1, failed: 1 });
  });

  it("counts a story as failed, and gives it back, when its links cannot be saved", async () => {
    const { store, claimed } = storeOf([story(1)]);
    vi.mocked(store.save).mockRejectedValue(new Error("database is down"));

    const result = await findFreeLinks([1], { store, search: async () => [], checkLinks: keepFree, log: vi.fn() });

    expect(result).toMatchObject({ stories: 1, links: 0, failed: 1 });
    expect(claimed.has(1)).toBe(false);
  });

  it("does not work on a story that another run took first", async () => {
    const { store, saved } = storeOf([story(1), story(2)]);
    vi.mocked(store.claim).mockImplementation(async (storyId: number) => storyId !== 1);
    const search = vi.fn(async () => []);

    const result = await findFreeLinks([1, 2], { store, search, checkLinks: keepFree });

    expect(search).toHaveBeenCalledTimes(1);
    expect(saved.has(1)).toBe(false);
    expect(result.stories).toBe(1);
  });

  it("works on 3 stories at once, never more", async () => {
    const { store } = storeOf([1, 2, 3, 4, 5, 6, 7].map(story));
    let running = 0;
    let most = 0;
    const search = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return [];
    });

    const result = await findFreeLinks([1, 2, 3, 4, 5, 6, 7], { store, search, checkLinks: keepFree });

    expect(most).toBe(3);
    expect(result.stories).toBe(7);
  });

  it("starts no new story after the time limit, and leaves the rest not searched", async () => {
    const { store, saved } = storeOf([1, 2, 3, 4].map(story));
    let clock = NOW.getTime();
    const search = vi.fn(async () => {
      clock += 5 * 60_000;
      return [];
    });

    const result = await findFreeLinks([1, 2, 3, 4], { store, search, checkLinks: keepFree, now: () => new Date(clock), concurrency: 1, timeLimitMs: 9 * 60_000 });

    expect([...saved.keys()]).toEqual([1, 2]);
    expect(result.stories).toBe(2);
  });
});

describe("describeFreeLinksRun", () => {
  it("says what the run did in one line", () => {
    expect(describeFreeLinksRun({ stories: 4, fromStories: 1, searched: 3, links: 6, failed: 1 })).toBe(
      "Looked for free links for 4 stories: 1 from our own stories, 3 web searches, 6 free links saved, 1 failed.",
    );
  });
});

describe("surePartners", () => {
  const match = (newerStoryId: number, olderStoryId: number, same: number, news = 0.1) => ({ newerStoryId, olderStoryId, same, news });

  it("gives the other story of each sure pair, whether the story is the newer or the older one", () => {
    expect(surePartners(5, [match(5, 2, 0.9), match(8, 5, 0.9)])).toEqual([2, 8]);
  });

  it("leaves out a pair that is only similar", () => {
    expect(surePartners(5, [match(5, 2, 0.7), match(5, 3, 0.95, 0.8)])).toEqual([]);
  });

  it("leaves out a pair of two other stories", () => {
    expect(surePartners(5, [match(7, 2, 0.95)])).toEqual([]);
  });

  it("gives the surest pair first, and the lower id first for equal pairs", () => {
    expect(surePartners(5, [match(5, 4, 0.9), match(5, 3, 0.99), match(5, 1, 0.9)])).toEqual([3, 1, 4]);
  });
});
