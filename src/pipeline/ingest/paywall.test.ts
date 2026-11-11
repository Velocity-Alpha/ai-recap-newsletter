import { describe, expect, it, vi } from "vitest";

import { checkPaywall, checkSiteList, isOnSiteList } from "@/src/pipeline/ingest/paywall";

function page(html: string, status = 200) {
  return vi.fn(async () => new Response(html, { status }));
}

describe("checkPaywall", () => {
  it("marks known paywalled sites without fetching them", async () => {
    const fetch = vi.fn();
    await expect(checkPaywall("https://www.wsj.com/tech/ai/story", { fetch })).resolves.toEqual({ status: "yes", error: "" });
    await expect(checkPaywall("https://ft.com/content/1", { fetch })).resolves.toEqual({ status: "yes", error: "" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers yes for a learned paywalled site, with no fetch", async () => {
    const fetch = vi.fn();
    const learnedSites = ["paywalled.example"];
    await expect(checkPaywall("https://paywalled.example/a", { fetch, learnedSites })).resolves.toEqual({ status: "yes", error: "" });
    await expect(checkPaywall("https://www.paywalled.example/b", { fetch, learnedSites })).resolves.toEqual({ status: "yes", error: "" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks known free sites without fetching them (Product Hunt always blocked n8n's fetch)", async () => {
    const fetch = vi.fn();
    for (const url of [
      "https://www.producthunt.com/products/gadget",
      "https://huggingface.co/papers/2611.00001",
      "https://github.com/org/repo",
      "https://arxiv.org/abs/2611.00001",
      "https://www.youtube.com/watch?v=1",
    ]) {
      await expect(checkPaywall(url, { fetch })).resolves.toEqual({ status: "no", error: "" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the publisher's isAccessibleForFree markup", async () => {
    const locked = '<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>';
    const lockedString = '<script type="application/ld+json">{"isAccessibleForFree": "False"}</script>';
    const free = '<script type="application/ld+json">{"isAccessibleForFree":true}</script>';
    const microdata = '<meta itemprop="isAccessibleForFree" content="false">';

    await expect(checkPaywall("https://news.example/a", { fetch: page(locked) })).resolves.toEqual({ status: "yes", error: "" });
    await expect(checkPaywall("https://news.example/b", { fetch: page(lockedString) })).resolves.toEqual({ status: "yes", error: "" });
    await expect(checkPaywall("https://news.example/c", { fetch: page(free) })).resolves.toEqual({ status: "no", error: "" });
    await expect(checkPaywall("https://news.example/d", { fetch: page(microdata) })).resolves.toEqual({ status: "yes", error: "" });
  });

  it("reads the content tier tag and clear subscriber-only wording", async () => {
    await expect(
      checkPaywall("https://news.example/e", { fetch: page('<meta property="article:content_tier" content="locked">') }),
    ).resolves.toEqual({ status: "yes", error: "" });
    await expect(
      checkPaywall("https://news.example/f", { fetch: page('<meta property="article:content_tier" content="free">') }),
    ).resolves.toEqual({ status: "no", error: "" });
    await expect(
      checkPaywall("https://news.example/g", { fetch: page("<p>This article is available to subscribers only.</p>") }),
    ).resolves.toEqual({ status: "yes", error: "" });
  });

  it("does not treat a footer 'Already a subscriber?' link as a paywall", async () => {
    await expect(
      checkPaywall("https://news.example/h", { fetch: page("<article>Full text</article><footer>Already a subscriber? Sign in</footer>") }),
    ).resolves.toEqual({ status: "unknown", error: "" });
  });

  it("reports blocked and failed fetches as errors", async () => {
    await expect(checkPaywall("https://news.example/i", { fetch: page("denied", 403) })).resolves.toEqual({
      status: "error",
      error: "HTTP 403",
    });
    const failing = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    await expect(checkPaywall("https://news.example/j", { fetch: failing })).resolves.toEqual({
      status: "error",
      error: "TimeoutError",
    });
  });

  it("returns unknown for a link it cannot read", async () => {
    await expect(checkPaywall("", { fetch: vi.fn() })).resolves.toEqual({ status: "unknown", error: "" });
  });
});

describe("checkSiteList", () => {
  it("answers yes for a site on the paywalled list", () => {
    expect(checkSiteList("https://www.wsj.com/tech/ai/story")).toBe("yes");
  });

  it("answers no for a site on the free list", () => {
    expect(checkSiteList("https://github.com/org/repo")).toBe("no");
  });

  it("answers yes for a learned paywalled site", () => {
    expect(checkSiteList("https://news.example/a", ["news.example"])).toBe("yes");
  });

  it("answers null for a site on no list", () => {
    expect(checkSiteList("https://news.example/a")).toBeNull();
  });

  it("answers null for text that is not an http or https link", () => {
    expect(checkSiteList("not a link")).toBeNull();
    expect(checkSiteList("ftp://wsj.com/a")).toBeNull();
  });
});

describe("isOnSiteList", () => {
  it("matches the site itself and its subdomains, not a site that only ends with the same letters", () => {
    expect(isOnSiteList("ft.com", ["ft.com"])).toBe(true);
    expect(isOnSiteList("www.ft.com", ["ft.com"])).toBe(true);
    expect(isOnSiteList("markets.ft.com", ["ft.com"])).toBe(true);
    expect(isOnSiteList("swift.com", ["ft.com"])).toBe(false);
  });
});
