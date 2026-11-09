import { describe, expect, it } from "vitest";

import { cleanStoryUrl, storyGuid } from "@/src/pipeline/ingest/url";

describe("cleanStoryUrl", () => {
  it("cleans like n8n: https, lowercase host, no fragment, no trailing slash, no double slashes", () => {
    expect(cleanStoryUrl("  http://Alignment.Anthropic.com/2026//anthropic-residency/#apply ")).toBe(
      "https://alignment.anthropic.com/2026/anthropic-residency",
    );
    expect(cleanStoryUrl("openai.com/index/lifeval/")).toBe("https://openai.com/index/lifeval");
    expect(cleanStoryUrl("https://example.org/")).toBe("https://example.org");
  });

  it("removes tracking parameters but keeps the ones a link needs", () => {
    expect(cleanStoryUrl("https://openai.com/index/lifeval/?utm_source=tldrai")).toBe(
      "https://openai.com/index/lifeval",
    );
    expect(cleanStoryUrl("https://www.youtube.com/watch?v=abc123&utm_medium=email&fbclid=x")).toBe(
      "https://www.youtube.com/watch?v=abc123",
    );
    expect(cleanStoryUrl("https://news.ycombinator.com/item?id=42&ref=alphasignal")).toBe(
      "https://news.ycombinator.com/item?id=42",
    );
  });

  it("decodes percent-escapes that newsletters double-encode", () => {
    expect(cleanStoryUrl("https://example.org/a%2520b")).toBe("https://example.org/a%20b");
    expect(cleanStoryUrl("https://example.org/100%")).toBe("https://example.org/100%25");
  });

  it("turns a full-width question mark into a query", () => {
    expect(cleanStoryUrl("https://example.org/watch？v=1")).toBe("https://example.org/watch?v=1");
  });

  it("returns an empty string when there is no usable link", () => {
    expect(cleanStoryUrl("")).toBe("");
    expect(cleanStoryUrl("   ")).toBe("");
    expect(cleanStoryUrl("not a link")).toBe("");
    expect(cleanStoryUrl("mailto:hello@example.org")).toBe("");
  });
});

describe("storyGuid", () => {
  it("uses n8n's formula, so rows from n8n and native match", () => {
    // Verified against production row 10987.
    expect(storyGuid("2026-11-03", "https://openai.com/index/lifeval")).toBe("95047d0d8318482c8a1679aeee661123");
  });
});
