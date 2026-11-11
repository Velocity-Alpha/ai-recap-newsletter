import { describe, expect, it } from "vitest";

import { firstWords, sameNewsInput } from "@/evals/free-links/rubric";
import { scoreFreeLinks, storyCostUsd, type CheckedFoundLink, type FreeLinksItem, type FreeLinksOutput } from "@/evals/free-links/score";
import type { Outcome } from "@/evals/lib/sweep";

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

const outcome = (storyId: number, url: string, output: FreeLinksOutput | null): Outcome<FreeLinksItem, FreeLinksOutput> => ({
  item: { story: { id: storyId, url } },
  id: String(storyId),
  repeat: 0,
  latencyMs: 1,
  output,
  error: output ? null : "timeout",
});

const output = (links: CheckedFoundLink[], searches = 2): FreeLinksOutput => ({
  searches,
  answerParsed: true,
  links,
  searchMs: 10_000,
  tokenUsd: 0.003,
});

describe("scoreFreeLinks", () => {
  it("counts usable stories and links, failed reads, paywall sites, the owner's site, searches and cost", () => {
    const metrics = scoreFreeLinks([
      outcome(1, "https://wsj.com/x", output([link({}), link({ url: "https://b.com/x", site: "b.com", sameNews: "related" })])),
      outcome(10844, "https://finance.yahoo.com/x", output([
        link({ url: "https://finance.yahoo.com/y", site: "finance.yahoo.com", read: false, readStatus: null, kept: false, sameNews: null }),
        link({ url: "https://c.com/x", site: "c.com", readStatus: "blocked", kept: false, words: 0, sameNews: null }),
        link({ url: "https://d.com/x", site: "d.com", readStatus: "read", kept: false, words: 120, sameNews: null }),
        link({ url: "https://wsj.com/y", site: "wsj.com", onPaywallSite: true, read: false, readStatus: null, kept: false, sameNews: null }),
      ], 4)),
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
    expect(byName.get("Searches per story")).toEqual({ name: "Searches per story", value: 3 });
    expect((byName.get("Cost per story ¢ (incl. search fee)") as { value: number }).value).toBeCloseTo(3.3);
    expect(byName.get("Search p95 s")).toEqual({ name: "Search p95 s", value: 10 });
  });

  it("prices a story's searches at $0.01 each on top of its tokens", () => {
    expect(storyCostUsd(output([], 3))).toBeCloseTo(0.033);
  });
});

describe("the same-news rubric input", () => {
  it("cuts the article to its first words", () => {
    expect(firstWords(" one  two three ", 2)).toBe("one two");
    expect(sameNewsInput({ headline: "H", summary: "S" }, { url: "https://e.com" }, "a b c")).toContain("Link: https://e.com");
  });
});
