import { describe, expect, it } from "vitest";

import { issueStoryRows } from "@/src/pipeline/publish/issue-stories";
import type { PublishedIssueContent, StorySectionKey } from "@/src/pipeline/publish/sent-email-parser";

type Item = { story_id: number; url: string };

function content(sections: Partial<Record<StorySectionKey, Item[]>>) {
  return { headlines: [], research_and_analysis: [], tools: [], quick_hits: [], ...sections } as unknown as PublishedIssueContent;
}

const item = (story_id: number, url = `https://example.test/${story_id}`): Item => ({ story_id, url });

describe("issueStoryRows", () => {
  it("gives one row for each story, section by section, with positions from 1 in each section", () => {
    const rows = issueStoryRows(
      content({
        quick_hits: [item(41), item(42)],
        tools: [item(31)],
        headlines: [item(11), item(12)],
        research_and_analysis: [item(21)],
      }),
      undefined,
    );

    expect(rows).toEqual([
      { storyId: 11, section: "headlines", position: 1, url: "https://example.test/11", isLead: null },
      { storyId: 12, section: "headlines", position: 2, url: "https://example.test/12", isLead: null },
      { storyId: 21, section: "research_and_analysis", position: 1, url: "https://example.test/21", isLead: null },
      { storyId: 31, section: "tools", position: 1, url: "https://example.test/31", isLead: null },
      { storyId: 41, section: "quick_hits", position: 1, url: "https://example.test/41", isLead: null },
      { storyId: 42, section: "quick_hits", position: 2, url: "https://example.test/42", isLead: null },
    ]);
  });

  it("skips an item whose story id is not a positive whole number, and the item still takes its position", () => {
    const rows = issueStoryRows(content({ headlines: [item(Number.NaN), item(12), item(0), item(-3), item(1.5), item(16)] }), undefined);

    expect(rows.map((row) => [row.storyId, row.position])).toEqual([
      [12, 2],
      [16, 6],
    ]);
  });

  it("keeps the first row of a story that the email lists twice", () => {
    const rows = issueStoryRows(content({ headlines: [item(11), item(11, "https://example.test/again")], quick_hits: [item(11), item(42)] }), undefined);

    expect(rows.map((row) => [row.storyId, row.section, row.position, row.url])).toEqual([
      [11, "headlines", 1, "https://example.test/11"],
      [42, "quick_hits", 2, "https://example.test/42"],
    ]);
  });

  it("gives a null url for an item with an empty link", () => {
    expect(issueStoryRows(content({ tools: [item(31, "")] }), undefined)[0].url).toBeNull();
  });

  it("marks the lead story when the sent draft's outline is known", () => {
    const rows = issueStoryRows(content({ headlines: [item(11), item(12)], quick_hits: [item(41)] }), 12);

    expect(rows.map((row) => row.isLead)).toEqual([false, true, false]);
  });

  it("marks no story as the lead when the outline has no lead story", () => {
    const rows = issueStoryRows(content({ headlines: [item(11), item(12)] }), null);

    expect(rows.map((row) => row.isLead)).toEqual([false, false]);
  });

  it("gives no rows for content with no story sections", () => {
    expect(issueStoryRows({ title: "Old issue" } as unknown as PublishedIssueContent, undefined)).toEqual([]);
  });
});
