import { describe, expect, it } from "vitest";

import { hashOutline, normalizeOutline } from "@/src/pipeline/draft/outline";

/** A board commit body like ApprovalBoard sends, with made-up stories. */
function boardBody() {
  return {
    date: "2026-11-09",
    approved_ids_by_section: { top_stories: [11, 12], tools: [21] },
    excluded_stories: [
      { id: 31, headline: "H", summary: "S", note: "", reason: "duplicate", newsletter_category: "tools" },
    ],
    newsletter_headline: 12,
    candidate_sections: [
      { key: "top_stories", label: "Top Stories", max: 4, selected: [{ id: 11 }, { id: 12 }], fill_ins: [] },
      { key: "tools", label: "Tools", max: 3, selected: [{ id: 21 }], fill_ins: [] },
    ],
    candidate_map: { "11": { id: 11 } },
    selected_story_ids: [11, 12, 21],
    stories: [
      { id: 11, url: "https://example.com/a", note: "", newsletter_category: "top_stories", summary: "x" },
      { id: 12, url: "https://example.com/b-edited", note: "lead with the price", newsletter_category: "top_stories" },
      { id: 21, url: "https://example.com/c", note: "", newsletter_category: "tools" },
      { id: 31, url: "https://example.com/d", note: "", newsletter_category: "tools" },
    ],
    queue_update_count: 3,
  };
}

describe("normalizeOutline", () => {
  it("keeps sections in board order, the lead story, story edits and exclusions only", () => {
    expect(normalizeOutline(boardBody(), "2026-11-09")).toEqual({
      date: "2026-11-09",
      sections: [
        { key: "top_stories", storyIds: [11, 12] },
        { key: "tools", storyIds: [21] },
      ],
      leadStoryId: 12,
      stories: [
        { id: 11, section: "top_stories", url: "https://example.com/a", note: "" },
        { id: 12, section: "top_stories", url: "https://example.com/b-edited", note: "lead with the price" },
        { id: 21, section: "tools", url: "https://example.com/c", note: "" },
        { id: 31, section: "tools", url: "https://example.com/d", note: "" },
      ],
      excluded: [{ id: 31, section: "tools", reason: "duplicate" }],
    });
  });

  it("falls back to the approved-ids key order when candidate sections are missing", () => {
    const body = { ...boardBody(), candidate_sections: undefined };
    expect(normalizeOutline(body, "2026-11-09").sections.map((section) => section.key)).toEqual(["top_stories", "tools"]);
  });

  it("accepts numeric strings as story ids", () => {
    const body = { ...boardBody(), approved_ids_by_section: { top_stories: ["11", 12] }, newsletter_headline: "12" };
    const outline = normalizeOutline(body, "2026-11-09");
    expect(outline.sections[0].storyIds).toEqual([11, 12]);
    expect(outline.leadStoryId).toBe(12);
  });

  it.each([
    ["no approved stories", { approved_ids_by_section: undefined }],
    ["a bad story id", { approved_ids_by_section: { top_stories: ["abc"] } }],
    ["no story in any section", { approved_ids_by_section: { top_stories: [] } }],
  ])("rejects %s", (_name, override) => {
    expect(() => normalizeOutline({ ...boardBody(), ...override }, "2026-11-09")).toThrow();
  });
});

describe("hashOutline", () => {
  it("gives the same hash for the same outline, whatever extra fields the client sent", () => {
    const first = normalizeOutline(boardBody(), "2026-11-09");
    const second = normalizeOutline({ ...boardBody(), candidate_map: {}, queue_update_count: 99 }, "2026-11-09");
    expect(hashOutline(first)).toBe(hashOutline(second));
    expect(hashOutline(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the board order changes", () => {
    const body = boardBody();
    const reordered = { ...body, approved_ids_by_section: { top_stories: [12, 11], tools: [21] } };
    expect(hashOutline(normalizeOutline(reordered, "2026-11-09"))).not.toBe(
      hashOutline(normalizeOutline(body, "2026-11-09")),
    );
  });
});
