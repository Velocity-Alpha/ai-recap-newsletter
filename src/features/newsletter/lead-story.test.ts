import { describe, expect, it } from "vitest";

import { leadScore, proposeLeadStory, storySources } from "@/src/features/newsletter/lead-story";

type Story = {
  id: number;
  headline: string | null;
  importance_score: number | null;
  source: string | null;
  sources?: string[];
  paywall_detected?: "yes" | "no" | "unknown" | "error";
};

function story(id: number, importance: number, overrides: Partial<Story> = {}): Story {
  const sources = overrides.sources ?? ["tldr"];
  return { id, headline: `Story ${id}`, importance_score: importance, source: sources[0], sources, ...overrides };
}

function sections(selected: Record<string, Story[]>) {
  return Object.entries(selected).map(([key, stories]) => ({ key, selected: stories }));
}

describe("storySources", () => {
  it("counts each newsletter once, including the row's own source", () => {
    expect(storySources({ source: "tldr", sources: ["rundown_ai", "tldr", "rundown_ai"] })).toEqual([
      "rundown_ai",
      "tldr",
    ]);
  });

  it("falls back to the row's source when no mentions were loaded", () => {
    expect(storySources({ source: "tldr" })).toEqual(["tldr"]);
    expect(storySources({ source: null })).toEqual([]);
  });
});

describe("leadScore", () => {
  it("starts from the importance score and adds one point per extra source", () => {
    expect(leadScore(story(1, 4))).toBe(4);
    expect(leadScore(story(1, 4, { sources: ["tldr", "rundown_ai", "alphasignal"] }))).toBe(6);
  });

  it("adds a point for a major lab, and another for a model launch from one", () => {
    expect(leadScore(story(1, 4, { headline: "Anthropic Opens Paid AI Safety Residency" }))).toBe(5);
    expect(leadScore(story(1, 4, { headline: "Kimi Releases 104B Open-Weight Model With 1M-Token Context" }))).toBe(6);
    expect(leadScore(story(1, 4, { headline: "Google Introduces Gemini 4 Carbon" }))).toBe(6);
    expect(leadScore(story(1, 4, { headline: "MiniMax Opens A Paris Office" }))).toBe(5);
  });

  it("adds a point for an IPO or a giant round", () => {
    expect(leadScore(story(1, 4, { headline: "Fal Raises $1.3B At $16B Valuation" }))).toBe(5);
    expect(leadScore(story(1, 4, { headline: "Startup Raises $12M Seed" }))).toBe(4);
  });

  it("takes a point off doom and gloom", () => {
    expect(leadScore(story(1, 4, { headline: "LiteLLM Release v1.107.0 Compromised" }))).toBe(3);
  });
});

describe("proposeLeadStory", () => {
  it("proposes the highest-scoring story with its section", () => {
    const board = sections({ headlines: [story(1, 4), story(2, 5), story(3, 4)] });
    expect(proposeLeadStory(board)).toEqual({ id: 2, sectionKey: "headlines" });
  });

  it("lets coverage across sources outrank a higher importance score", () => {
    const board = sections({
      headlines: [story(1, 5), story(2, 4, { sources: ["tldr", "rundown_ai", "ai_breakfast"] })],
    });
    expect(proposeLeadStory(board)?.id).toBe(2);
  });

  it("keeps board order on a tie, Top Stories first", () => {
    const board = sections({ quickHits: [story(3, 4)], headlines: [story(1, 4), story(2, 4)] });
    expect(proposeLeadStory(board)?.id).toBe(1);
  });

  it("can propose a Tools or Quick Hits story", () => {
    const board = sections({
      headlines: [story(1, 4)],
      tools: [story(4, 4, { headline: "Mistral Releases Mistral Large 4 Weights" })],
    });
    expect(proposeLeadStory(board)).toEqual({ id: 4, sectionKey: "tools" });
  });

  it("proposes research only when several sources covered it", () => {
    const single = sections({ headlines: [story(1, 3)], research: [story(2, 5)] });
    expect(proposeLeadStory(single)?.id).toBe(1);

    const covered = sections({
      headlines: [story(1, 3)],
      research: [story(2, 4, { sources: ["tldr", "rundown_ai"] })],
    });
    expect(proposeLeadStory(covered)?.id).toBe(2);
  });

  it("skips a Hugging Face paper or a Product Hunt launch that no newsletter picked up", () => {
    const board = sections({
      headlines: [story(1, 3)],
      tools: [story(2, 5, { sources: ["product_hunt_ai"] }), story(3, 5, { sources: ["huggingface"] })],
    });
    expect(proposeLeadStory(board)?.id).toBe(1);
  });

  it("never proposes a paywalled link, since the board has no free alternative yet", () => {
    const board = sections({ headlines: [story(1, 5, { paywall_detected: "yes" }), story(2, 3)] });
    expect(proposeLeadStory(board)?.id).toBe(2);
  });

  it("proposes nothing when no story is eligible", () => {
    expect(proposeLeadStory(sections({ headlines: [], research: [story(2, 5)] }))).toBeNull();
  });
});
