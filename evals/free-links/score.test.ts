import { describe, expect, it } from "vitest";

import {
  linkKey,
  scoreFreeLinks,
  type CheckedFoundLink,
  type FreeLinksGolden,
  type FreeLinksGrade,
  type FreeLinksItem,
  type FreeLinksOutput,
} from "@/evals/free-links/score";
import type { Outcome } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";

const link = (change: Partial<CheckedFoundLink>): CheckedFoundLink => ({
  url: "https://example.com/a",
  site: "example.com",
  onPaywallSite: false,
  read: true,
  readStatus: "read",
  words: 800,
  kept: true,
  sameNews: "same",
  ...change,
});

/** A checked story: the search found the links, and the check made `links` of them. */
const FREE: FreeLinksGolden = { free_source_exists: true, urls: ["https://example.com/a"] };
const NONE: FreeLinksGolden = { free_source_exists: false, urls: [] };

const outcome = (
  storyId: number,
  url: string,
  links: CheckedFoundLink[] | null,
  golden: FreeLinksGolden = FREE
): Outcome<FreeLinksItem, FreeLinksOutput, FreeLinksGrade> =>
  outcomeOf({
    item: { story: { id: storyId, url }, golden },
    id: String(storyId),
    output: links ? { answerParsed: true, found: links.map((entry) => ({ url: entry.url, title: "" })) } : null,
    grade: links ? { links } : null,
    error: links ? null : "timeout",
  });

describe("scoreFreeLinks", () => {
  const metrics = () =>
    new Map(
      scoreFreeLinks([
        outcome(1, "https://wsj.com/x", [link({}), link({ url: "https://b.com/x", site: "b.com", sameNews: "related" })]),
        outcome(10844, "https://finance.yahoo.com/x", [
          link({ url: "https://finance.yahoo.com/y", site: "finance.yahoo.com", read: false, readStatus: null, kept: false, sameNews: null }),
          link({ url: "https://c.com/x", site: "c.com", readStatus: "blocked", kept: false, words: 0, sameNews: null }),
          link({ url: "https://d.com/x", site: "d.com", readStatus: "read", kept: false, words: 120, sameNews: null }),
          link({ url: "https://wsj.com/y", site: "wsj.com", onPaywallSite: true, read: false, readStatus: null, kept: false, sameNews: null }),
        ]),
        outcome(11042, "https://ctvnews.ca/x", null),
      ]).map((metric) => [metric.name, metric])
    );

  it("counts recall over the stories golden says have a free link: a usable link found", () => {
    expect(metrics().get("Recall: usable link, golden has one")).toEqual({ name: "Recall: usable link, golden has one", hits: 1, n: 3 });
  });

  it("counts precision as kept links the judge calls the same news", () => {
    expect(metrics().get("Precision: kept links judged same news")).toEqual({ name: "Precision: kept links judged same news", hits: 1, n: 2 });
  });

  it("counts apart the stories golden says have no free link, but that got a kept link", () => {
    const counted = scoreFreeLinks([
      outcome(7, "https://ft.com/x", [link({ url: "https://e.com/kept", site: "e.com", sameNews: "different" })], NONE),
      outcome(8, "https://ft.com/y", [link({ kept: false, sameNews: null })], NONE),
    ]);
    expect(counted.find((metric) => metric.name === "No free source (golden): stories with a kept link")).toEqual({
      name: "No free source (golden): stories with a kept link",
      hits: 1,
      n: 2,
    });
  });

  it("counts kept links that are golden URLs, matched without scheme, www, query or trailing slash", () => {
    expect(metrics().get("Kept links among golden URLs")).toEqual({ name: "Kept links among golden URLs", hits: 1, n: 2 });
  });

  it("matches a golden URL without scheme, www, query, fragment or trailing slash", () => {
    expect(linkKey("http://www.Example.com/a/?utm=x#top")).toBe(linkKey("https://example.com/a"));
  });

  it("counts a story with a kept link the judge calls the same news as usable, a failed search as a miss", () => {
    expect(metrics().get("Stories with a usable link")).toEqual({ name: "Stories with a usable link", hits: 1, n: 3 });
  });

  it("counts the stories with a kept link, a failed search as a miss", () => {
    expect(metrics().get("Stories with a kept link")).toEqual({ name: "Stories with a kept link", hits: 1, n: 3 });
  });

  it("counts usable links over every found link", () => {
    expect(metrics().get("Usable links")).toEqual({ name: "Usable links", hits: 1, n: 6 });
  });

  it("counts kept links the judge calls other news", () => {
    expect(metrics().get("Kept, judged not same news")).toEqual({ name: "Kept, judged not same news", hits: 1, n: 2 });
  });

  it("counts failed reads over the links that were read", () => {
    expect(metrics().get("Links that fail to read")).toEqual({ name: "Links that fail to read", hits: 1, n: 4 });
  });

  it("counts short reads over the links that were read", () => {
    expect(metrics().get("Read but too short")).toEqual({ name: "Read but too short", hits: 1, n: 4 });
  });

  it("counts links on a paywalled site", () => {
    expect(metrics().get("Links on a paywall site")).toEqual({ name: "Links on a paywall site", hits: 1, n: 6 });
  });

  it("counts a link on the owner's replacement site for the stories the owner replaced", () => {
    expect(metrics().get("Owner's replacement site found")).toEqual({ name: "Owner's replacement site found", hits: 1, n: 2 });
  });

  it("averages the links found per story", () => {
    expect(metrics().get("Links per story")).toEqual({ name: "Links per story", value: 2 });
  });

  it("leaves a repeat the judge skipped out of the story counts", () => {
    const skipped = { ...outcome(1, "https://wsj.com/x", [link({})]), grade: null, gradeStatus: "skipped" as const };
    const counted = scoreFreeLinks([outcome(2, "https://wsj.com/z", [link({})]), skipped]);
    expect(counted.find((metric) => metric.name === "Stories with a usable link")).toEqual({ name: "Stories with a usable link", hits: 1, n: 1 });
  });
});
