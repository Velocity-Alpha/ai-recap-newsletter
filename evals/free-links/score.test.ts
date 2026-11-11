import { describe, expect, it } from "vitest";

import { firstWords, sameNewsInput } from "@/evals/free-links/rubric";
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
  it("counts usable stories and links, failed reads, paywall sites and the owner's site; a failed search is a miss", () => {
    const metrics = scoreFreeLinks([
      outcome(1, "https://wsj.com/x", [link({}), link({ url: "https://b.com/x", site: "b.com", sameNews: "related" })]),
      outcome(10844, "https://finance.yahoo.com/x", [
        link({ url: "https://finance.yahoo.com/y", site: "finance.yahoo.com", read: false, readStatus: null, kept: false, sameNews: null }),
        link({ url: "https://c.com/x", site: "c.com", readStatus: "blocked", kept: false, words: 0, sameNews: null }),
        link({ url: "https://d.com/x", site: "d.com", readStatus: "read", kept: false, words: 120, sameNews: null }),
        link({ url: "https://wsj.com/y", site: "wsj.com", onPaywallSite: true, read: false, readStatus: null, kept: false, sameNews: null }),
      ]),
      outcome(11042, "https://ctvnews.ca/x", null),
    ]);
    const byName = new Map(metrics.map((metric) => [metric.name, metric]));
    expect(byName.get("Stories with a usable link")).toEqual({ name: "Stories with a usable link", hits: 1, n: 3 });
    expect(byName.get("Stories with a kept link")).toEqual({ name: "Stories with a kept link", hits: 1, n: 3 });
    expect(byName.get("Usable links")).toEqual({ name: "Usable links", hits: 1, n: 6 });
    expect(byName.get("Kept, judged not same news")).toEqual({ name: "Kept, judged not same news", hits: 1, n: 2 });
    expect(byName.get("Links that fail to read")).toEqual({ name: "Links that fail to read", hits: 1, n: 4 });
    expect(byName.get("Read but too short")).toEqual({ name: "Read but too short", hits: 1, n: 4 });
    expect(byName.get("Links on a paywall site")).toEqual({ name: "Links on a paywall site", hits: 1, n: 6 });
    expect(byName.get("Owner's replacement site found")).toEqual({ name: "Owner's replacement site found", hits: 1, n: 2 });
    expect(byName.get("Links per story")).toEqual({ name: "Links per story", value: 2 });
  });

  it("leaves a repeat the judge skipped out of the story counts", () => {
    const skipped = { ...outcome(1, "https://wsj.com/x", [link({})]), grade: null, gradeStatus: "skipped" as const };
    const metrics = scoreFreeLinks([outcome(2, "https://wsj.com/z", [link({})]), skipped]);
    expect(metrics[0]).toEqual({ name: "Stories with a usable link", hits: 1, n: 1 });
  });
});

describe("the same-news rubric input", () => {
  it("cuts the article to its first words", () => {
    expect(firstWords(" one  two three ", 2)).toBe("one two");
    expect(sameNewsInput({ headline: "H", summary: "S" }, { url: "https://e.com" }, "a b c")).toContain("Link: https://e.com");
  });
});
