import { readFileSync } from "node:fs";
import { join } from "node:path";

import { siteOf } from "@/src/pipeline/free-links/sites";

/**
 * The free-links test set: paywalled stories (paywall check "yes") of our own text (headline, summary) and their
 * public link, frozen in evals/free-links/stories.json so a reset of the Neon dev branch does not change it.
 * evals/free-links/build-stories.ts writes the file (`npm run eval:build`).
 */

export const STORIES_PATH = join("evals", "free-links", "stories.json");
/** Stories in the test set. */
export const SET_SIZE = 100;
/** Most stories of one paywalled site, so the big news sites do not fill the set. */
export const SITE_CAP = 12;

export interface PaywalledStory {
  id: number;
  source: string;
  /** The story's day (YYYY-MM-DD). */
  day: string;
  headline: string;
  summary: string;
  /** The paywalled link. */
  url: string;
}

export interface StoriesFile {
  note: string;
  stories: PaywalledStory[];
}

export function readStories(path = STORIES_PATH): PaywalledStory[] {
  return (JSON.parse(readFileSync(path, "utf8")) as StoriesFile).stories;
}

/** The golden input of a story: what a golden agent reads, and what `inputHash` is over. */
export function goldenInput(story: PaywalledStory): { id: number; headline: string; summary: string; url: string } {
  return { id: story.id, headline: story.headline, summary: story.summary, url: story.url };
}

/** Indexes 0..n-1 in an order that spreads over the range: the middle first, then the quarters, and so on. */
export function spreadOrder(n: number): number[] {
  const order: number[] = [];
  const seen = new Set<number>();
  for (let parts = 1; order.length < n; parts *= 2) {
    for (let k = 1; k < 2 * parts; k += 2) {
      const index = Math.min(n - 1, Math.floor((k * n) / (2 * parts)));
      if (!seen.has(index)) {
        seen.add(index);
        order.push(index);
      }
    }
  }
  return order;
}

/**
 * The test set: the `keep` stories first (the recorded search answers), then one story of each source in turn,
 * each source's stories in an order spread over its days, until `size`. One story per link; at most `siteCap` of
 * one site. Sorted by day, then id.
 */
export function pickStories(candidates: PaywalledStory[], keep: PaywalledStory[], size = SET_SIZE, siteCap = SITE_CAP): PaywalledStory[] {
  const picked: PaywalledStory[] = [];
  const urls = new Set<string>();
  const perSite = new Map<string, number>();
  const add = (story: PaywalledStory, cap: boolean): boolean => {
    const site = siteOf(story.url) ?? "";
    if (urls.has(story.url) || picked.some((entry) => entry.id === story.id)) return false;
    if (cap && (perSite.get(site) ?? 0) >= siteCap) return false;
    picked.push(story);
    urls.add(story.url);
    perSite.set(site, (perSite.get(site) ?? 0) + 1);
    return true;
  };
  keep.forEach((story) => add(story, false));

  const bySource = new Map<string, PaywalledStory[]>();
  for (const story of [...candidates].sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id)) {
    bySource.set(story.source, [...(bySource.get(story.source) ?? []), story]);
  }
  const queues = [...bySource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, stories]) => spreadOrder(stories.length).map((index) => stories[index]));
  while (picked.length < size && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      while (queue.length > 0 && picked.length < size) {
        if (add(queue.shift()!, true)) break;
      }
    }
  }
  return picked.sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id);
}
