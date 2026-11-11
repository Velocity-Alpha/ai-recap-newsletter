import { describe, expect, it } from "vitest";

import { scoreFreeLinks, type CheckedFoundLink, type FreeLinksGrade, type FreeLinksItem, type FreeLinksOutput } from "@/evals/free-links/score";
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
const outcome = (storyId: number, url: string, links: CheckedFoundLink[] | null): Outcome<FreeLinksItem, FreeLinksOutput, FreeLinksGrade> =>
  outcomeOf({
    item: { story: { id: storyId, url } },
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
    expect(counted[0]).toEqual({ name: "Stories with a usable link", hits: 1, n: 1 });
  });
});
