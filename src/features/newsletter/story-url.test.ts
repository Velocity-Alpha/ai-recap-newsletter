import { describe, expect, it } from "vitest";

import { storyUrlKey } from "@/src/features/newsletter/story-url";

describe("storyUrlKey", () => {
  it("cleans a URL the same way ingestion does", () => {
    expect(storyUrlKey("http://Blog.Google/innovation//gemini-4-carbon/?utm_source=tldr#top")).toBe(
      "https://blog.google/innovation/gemini-4-carbon"
    );
    expect(storyUrlKey("  www.anthropic.com/news/claude-opus-5  ")).toBe(
      "https://www.anthropic.com/news/claude-opus-5"
    );
    expect(storyUrlKey("https://example.com/caf%C3%A9-launch")).toBe(
      "https://example.com/café-launch"
    );
  });

  it("gives an already-cleaned URL the same key", () => {
    const cleaned = "https://alignment.anthropic.com/2026/anthropic-residency";
    expect(storyUrlKey(cleaned)).toBe(cleaned);
    expect(storyUrlKey(`${cleaned}/`)).toBe(cleaned);
  });

  it("does not throw on a malformed percent sign", () => {
    expect(storyUrlKey("https://example.com/100%-open-model")).toBe(
      "https://example.com/100%-open-model"
    );
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["homepage", "https://regularized-rsi.com/"],
    ["index page", "https://qwen.ai/blog"],
    ["video page without its id", "https://www.youtube.com/watch?v=abc123"],
    ["pricing page", "https://chatgpt.com/pricing"],
    ["Product Hunt product page", "https://www.producthunt.com/products/claude"],
    ["GitHub repository home", "https://github.com/anthropics/claude-code"],
  ])("returns no key for a %s URL, which can hold different stories", (_kind, url) => {
    expect(storyUrlKey(url)).toBeNull();
  });

  it.each([
    "https://x.com/OpenAI/status/2080378182469857576",
    "https://arxiv.org/abs/2609.19969",
    "https://openai.com/collective-cyberdefense",
    "https://huggingface.co/baidu/Unlimited-OCR",
    "https://github.com/openai/codex/releases/tag/v1.2.0",
  ])("returns a key for a page about one story: %s", (url) => {
    expect(storyUrlKey(url)).toBe(url);
  });
});
