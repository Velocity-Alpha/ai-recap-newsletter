import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { toApprovedSections, type StoryRow } from "@/src/pipeline/draft/approved-stories";
import { SAMPLE_APPROVED, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";

/** The stories as the database has them: the original link for 501, and no note for 502. */
function storyRows(): StoryRow[] {
  return Object.values(SAMPLE_APPROVED)
    .flat()
    .map((story) => ({
      id: story.id,
      headline: story.headline,
      summary: story.summary,
      storyDetails: story.storyDetails,
      url: story.id === 501 ? "https://news.example.test/planner" : story.url,
      note: null,
    }))
    .reverse();
}

describe("toApprovedSections", () => {
  it("groups the stories by board section in board order, with the outline's link and note edits", () => {
    expect(toApprovedSections(SAMPLE_OUTLINE, storyRows())).toEqual(SAMPLE_APPROVED);
  });

  it("keeps the database note and link for a story the outline does not list", () => {
    const rows = storyRows().map((row) => (row.id === 505 ? { ...row, note: "From the database." } : row));
    expect(toApprovedSections(SAMPLE_OUTLINE, rows).tools[0]).toMatchObject({ id: 505, note: "From the database." });
  });

  it("names a story that is not in the database", () => {
    const rows = storyRows().filter((row) => row.id !== 504);
    expect(() => toApprovedSections(SAMPLE_OUTLINE, rows)).toThrow("Story 504 is in the outline but not in the database.");
  });

  it("names a section the board does not have", () => {
    const outline = { ...SAMPLE_OUTLINE, sections: [...SAMPLE_OUTLINE.sections, { key: "extras", storyIds: [] }] };
    expect(() => toApprovedSections(outline, storyRows())).toThrow('The outline has a section "extras" that the board does not have.');
  });

  it("names a story without a link", () => {
    const rows = storyRows().map((row) => (row.id === 506 ? { ...row, url: " " } : row));
    expect(() => toApprovedSections(SAMPLE_OUTLINE, rows)).toThrow("Story 506 has no link.");
  });

  it("names a story approved in two sections", () => {
    const outline = {
      ...SAMPLE_OUTLINE,
      sections: SAMPLE_OUTLINE.sections.map((section) =>
        section.key === "quickHits" ? { ...section, storyIds: [...section.storyIds, 501] } : section,
      ),
    };
    expect(() => toApprovedSections(outline, storyRows())).toThrow("Story 501 is approved in more than one section.");
  });
});
