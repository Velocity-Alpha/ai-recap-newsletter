import { describe, expect, it } from "vitest";

import { repeatOfText, restoreRepeat, similarLabel, similarTooltip } from "@/src/components/approval/repeat-labels";

describe("repeatOfText", () => {
  it("names the published story and its day", () => {
    expect(repeatOfText({ id: 1, headline: "OpenAI ships GPT-6", date: "2026-11-06", kind: "published" })).toBe(
      'repeat of "OpenAI ships GPT-6", 6 Nov'
    );
  });

  it("names the unsent draft for a held story", () => {
    expect(repeatOfText({ id: 1, headline: "OpenAI ships GPT-6", date: "2026-11-09", kind: "held" })).toBe(
      'repeat of "OpenAI ships GPT-6", in the unsent draft for 9 Nov'
    );
  });
});

describe("similarLabel", () => {
  it("names a published or held story and its day", () => {
    expect(similarLabel({ kind: "published", id: 1, headline: "Claude 5", date: "2026-11-05" })).toBe('similar: "Claude 5", 5 Nov');
    expect(similarLabel({ kind: "held", id: 1, headline: "Claude 5", date: "2026-11-09" })).toBe('similar: "Claude 5", 9 Nov');
  });

  it("names the day a story was excluded, or says earlier when it is not known", () => {
    expect(similarLabel({ kind: "excluded", id: 1, headline: "X", date: "2026-11-07" })).toBe("like a story you excluded on 7 Nov");
    expect(similarLabel({ kind: "excluded", id: 1, headline: "X", date: null })).toBe("like a story you excluded earlier");
  });
});

describe("similarTooltip", () => {
  it("lists every similar story on its own line", () => {
    expect(
      similarTooltip([
        { kind: "published", id: 1, headline: "Claude 5", date: "2026-11-05" },
        { kind: "excluded", id: 2, headline: "Gemini 4", date: null },
      ])
    ).toBe('similar: "Claude 5", 5 Nov\nlike a story you excluded earlier: "Gemini 4"');
  });
});

describe("restoreRepeat", () => {
  const sections = [
    { key: "headlines", stories: [{ story: { id: 1 }, status: "selected" as const }] },
    { key: "research", stories: [] },
  ];

  it("adds the story to the end of its section as a fill-in", () => {
    const restored = restoreRepeat(sections, { id: 9 }, "headlines");
    expect(restored[0].stories).toEqual([
      { story: { id: 1 }, status: "selected" },
      { story: { id: 9 }, status: "fill-in" },
    ]);
    expect(restored[1]).toBe(sections[1]);
  });

  it("does not add a story twice", () => {
    const once = restoreRepeat(sections, { id: 9 }, "research");
    expect(restoreRepeat(once, { id: 9 }, "research")).toBe(once);
  });
});
