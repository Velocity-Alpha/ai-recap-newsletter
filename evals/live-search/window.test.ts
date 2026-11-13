import { describe, expect, it } from "vitest";

import { isExcluded, normalizeUrl, windowFor } from "@/evals/live-search/window";

describe("windowFor", () => {
  it("starts 24 h before the previous weekday's 09:00 UTC run", () => {
    const w = windowFor("2026-11-04");
    expect(w.start.toISOString()).toBe("2026-11-02T09:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-04T09:00:00.000Z");
  });

  it("covers the weekend on a Monday", () => {
    expect(windowFor("2026-11-02").start.toISOString()).toBe("2026-10-29T09:00:00.000Z");
  });
});

describe("normalizeUrl", () => {
  it("drops www, a trailing slash and the query", () => {
    expect(normalizeUrl("https://www.openai.com/index/x/?utm=1")).toBe("openai.com/index/x");
  });

  it("drops a locale segment so translated copies count as one page", () => {
    expect(normalizeUrl("https://openai.com/ca-ES/index/introducing-gpt-rosalind/")).toBe("openai.com/index/introducing-gpt-rosalind");
  });

  it("keeps a two-letter path segment that is not a locale", () => {
    expect(normalizeUrl("https://example.com/ai/story")).toBe("example.com/ai/story");
  });
});

describe("isExcluded", () => {
  it("matches a domain and its subdomains", () => {
    expect(isExcluded("https://news.tldr.tech/a", ["tldr.tech"])).toBe(true);
    expect(isExcluded("https://tldr.tech/a", ["tldr.tech"])).toBe(true);
  });

  it("does not match a domain that only ends with the same letters", () => {
    expect(isExcluded("https://nottldr.tech/a", ["tldr.tech"])).toBe(false);
  });
});
