import { describe, expect, it, vi } from "vitest";

import type { CheckedLink, LinkCandidate } from "@/src/pipeline/free-links/check-links";
import {
  describeFreeLinksRun,
  findFreeLinks,
  type FreeLinkStory,
  type FreeLinksStore,
  type OwnStory,
  type SavedLink,
} from "@/src/pipeline/free-links/find-free-links";

const NOW = new Date("2026-11-10T12:00:00Z");

function story(id: number): FreeLinkStory {
  return { id, headline: `Headline ${id}`, summary: `Summary ${id}`, url: `https://www.wsj.com/story-${id}` };
}

function storeOf(stories: FreeLinkStory[], own: Record<number, OwnStory[]> = {}) {
  const saved = new Map<number, { links: SavedLink[]; at: Date }>();
  const store: FreeLinksStore = {
    storiesToSearch: vi.fn(async (ids: number[]) => stories.filter((entry) => ids.includes(entry.id) && !saved.has(entry.id))),
    ownStories: vi.fn(async (entry: FreeLinkStory) => own[entry.id] ?? []),
    save: vi.fn(async (storyId: number, links: SavedLink[], at: Date) => {
      saved.set(storyId, { links, at });
    }),
  };
  return { store, saved };
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
    expect(result).toEqual({ stories: 1, fromStories: 1, searched: 1 - 1, links: 1, failed: 0 });
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

    expect(store.storiesToSearch).toHaveBeenCalledWith([1, 2]);
    expect(search).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(result).toEqual({ stories: 0, fromStories: 0, searched: 0, links: 0, failed: 0 });
  });

  it("logs an error for one story, leaves it not searched, and goes on with the others", async () => {
    const { store, saved } = storeOf([story(1), story(2)]);
    const search = vi.fn(async (entry: { url: string }) => {
      if (entry.url.endsWith("story-1")) throw new Error("The web search is down.");
      return [{ url: "https://free.example/a", title: "A" }];
    });
    const log = vi.fn();

    const result = await findFreeLinks([1, 2], { store, search, checkLinks: keepFree, log });

    expect(saved.has(1)).toBe(false);
    expect(saved.get(2)?.links).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Story 1: The web search is down\./));
    expect(result).toEqual({ stories: 2, fromStories: 0, searched: 2, links: 1, failed: 1 });
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
