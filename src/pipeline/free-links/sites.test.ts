import { describe, expect, it } from "vitest";

import { MAX_LINKS, MIN_WORDS, siteOf, SKIPPED_SITES } from "@/src/pipeline/free-links/sites";

describe("siteOf", () => {
  it("gives the host name in lower case, without www.", () => {
    expect(siteOf("https://www.Example.com/a?b=1")).toBe("example.com");
    expect(siteOf("http://news.example.com/a")).toBe("news.example.com");
  });

  it("gives null for text that is not an http or https link", () => {
    expect(siteOf("not a link")).toBeNull();
    expect(siteOf("mailto:someone@example.com")).toBeNull();
    expect(siteOf("")).toBeNull();
  });
});

describe("the free link limits", () => {
  it("skips social and aggregator sites, needs 300 words, and keeps 3 links", () => {
    expect(SKIPPED_SITES).toEqual([
      "reddit.com",
      "facebook.com",
      "x.com",
      "twitter.com",
      "linkedin.com",
      "youtube.com",
      "youtu.be",
      "instagram.com",
      "threads.net",
      "tiktok.com",
      "news.ycombinator.com",
    ]);
    expect(MIN_WORDS).toBe(300);
    expect(MAX_LINKS).toBe(3);
  });
});
