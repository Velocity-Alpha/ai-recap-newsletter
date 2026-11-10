import { describe, expect, it } from "vitest";

import {
  applyLeadPick,
  leadScore,
  leadShortlist,
  moveLeadToTopStories,
  proposeLeadStory,
  storySources,
} from "@/src/features/newsletter/lead-story";

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

// A built board: Top Stories 1-3 (+ fill-in 4), Research 10-11 (+ fill-in 12), Tools 20 (no fill-in).
function builtBoard() {
  const option = (id: number) => ({ id, headline: `Story ${id}`, summary: `Summary ${id}` });
  const entries: Story[] = [
    story(1, 4),
    story(2, 5),
    story(3, 3),
    story(4, 5),
    story(10, 5),
    story(11, 4, { sources: ["tldr", "rundown_ai", "alphasignal"] }),
    story(12, 3),
    story(20, 4, { headline: "Mistral Releases Mistral Large 4 Weights" }),
  ];
  return {
    candidate_sections: [
      { key: "headlines", label: "Top Stories", max: 3, selected: [1, 2, 3].map(option), fill_ins: [option(4)] },
      { key: "research", label: "Research", max: 4, selected: [10, 11].map(option), fill_ins: [option(12)] },
      { key: "tools", label: "Tools", max: 3, selected: [option(20)], fill_ins: [] },
    ],
    candidate_map: Object.fromEntries(
      entries.map((entry) => [String(entry.id), { ...entry, summary: `Summary ${entry.id}` }])
    ),
    selected_story_ids: [1, 2, 3, 10, 11, 20],
    proposed_lead_id: 11 as number | null,
    proposed_lead_reason: null as string | null,
  };
}

describe("moveLeadToTopStories", () => {
  it("puts the lead first in Top Stories, promotes a fill-in where it left, and demotes the last Top Story", () => {
    const board = builtBoard();
    const moved = moveLeadToTopStories(board.candidate_sections, { id: 11, sectionKey: "research" });

    expect(moved[0].selected.map((s) => s.id)).toEqual([11, 1, 2]);
    expect(moved[0].fill_ins.map((s) => s.id)).toEqual([3, 4]);
    expect(moved[1].selected.map((s) => s.id)).toEqual([10, 12]);
    expect(moved[1].fill_ins).toEqual([]);
    // The input is left as it was (the board keeps it in React state).
    expect(board.candidate_sections[0].selected.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("leaves a Top Story lead where it is", () => {
    const board = builtBoard();
    expect(moveLeadToTopStories(board.candidate_sections, { id: 2, sectionKey: "headlines" })).toEqual(
      board.candidate_sections
    );
  });
});

describe("leadShortlist", () => {
  it("lists the selected stories that can lead, best score first", () => {
    const shortlist = leadShortlist(builtBoard(), 3);

    // 10 is single-source research and 4 is a fill-in, so neither can lead.
    expect(shortlist.map((entry) => entry.id)).toEqual([11, 20, 2]);
    expect(shortlist[0]).toEqual({
      id: 11,
      headline: "Story 11",
      summary: "Summary 11",
      section: "research",
      sources: 3,
      score: 6,
    });
  });
});

describe("applyLeadPick", () => {
  it("makes the picked story the proposed lead, with its reason, at the top of Top Stories", () => {
    const board = builtBoard();
    const picked = applyLeadPick(board, { leadId: 20, reason: "Open weights from a frontier lab." });

    expect(picked.proposed_lead_id).toBe(20);
    expect(picked.proposed_lead_reason).toBe("Open weights from a frontier lab.");
    expect(picked.candidate_sections[0].selected.map((s) => s.id)).toEqual([20, 1, 2]);
    expect([...picked.selected_story_ids].sort((a, b) => a - b)).toEqual([1, 2, 10, 11, 20]);
  });

  it("ignores a pick that is not on the shortlist", () => {
    const board = builtBoard();
    expect(applyLeadPick(board, { leadId: 4, reason: "A fill-in" })).toBe(board);
    expect(applyLeadPick(board, { leadId: 999, reason: "Made up" })).toBe(board);
  });
});
