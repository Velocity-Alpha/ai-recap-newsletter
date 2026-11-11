import { describe, expect, it } from "vitest";

import { pickStories, readStories, SET_SIZE, SITE_CAP, spreadOrder, type PaywalledStory } from "@/evals/free-links/stories";
import answers from "@/src/pipeline/free-links/__fixtures__/search-answers.json";
import { siteOf } from "@/src/pipeline/free-links/sites";

const story = (id: number, source: string, day: string, site = `site${id}.com`): PaywalledStory => ({
  id,
  source,
  day,
  headline: `H${id}`,
  summary: `S${id}`,
  url: `https://${site}/${id}`,
});

describe("spreadOrder", () => {
  it("gives every index once, the middle first", () => {
    const order = spreadOrder(7);
    expect(order[0]).toBe(3);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("pickStories", () => {
  it("keeps the given stories, then takes from each source in turn, spread over its days", () => {
    const kept = story(1, "a", "2026-10-01");
    const candidates = [story(2, "a", "2026-10-02"), story(3, "a", "2026-10-03"), story(4, "b", "2026-10-04")];
    expect(pickStories(candidates, [kept], 3).map((entry) => entry.id)).toEqual([1, 3, 4]);
  });

  it("takes one story per link and caps a site", () => {
    const candidates = [story(1, "a", "2026-10-01", "big.com"), story(2, "a", "2026-10-02", "big.com"), story(3, "a", "2026-10-03")];
    const duplicate = { ...story(4, "b", "2026-10-04"), url: candidates[2].url };
    expect(pickStories([...candidates, duplicate], [], 10, 1).map((entry) => entry.id)).toEqual([2, 4]);
  });
});

describe("the committed test set", () => {
  const stories = readStories();

  it(`has ${SET_SIZE} stories, each once, with our headline and summary`, () => {
    expect(stories).toHaveLength(SET_SIZE);
    expect(new Set(stories.map((entry) => entry.id)).size).toBe(SET_SIZE);
    expect(stories.every((entry) => entry.headline && entry.summary && siteOf(entry.url))).toBe(true);
  });

  it("holds the stories of the recorded search answers", () => {
    const ids = new Set(stories.map((entry) => entry.id));
    expect(answers.every((entry) => ids.has(entry.story.id))).toBe(true);
  });

  it(`has at most ${SITE_CAP} stories of one site, from several sources`, () => {
    const perSite = new Map<string, number>();
    for (const entry of stories) perSite.set(siteOf(entry.url)!, (perSite.get(siteOf(entry.url)!) ?? 0) + 1);
    expect(Math.max(...perSite.values())).toBeLessThanOrEqual(SITE_CAP);
    expect(new Set(stories.map((entry) => entry.source)).size).toBeGreaterThanOrEqual(4);
  });
});
