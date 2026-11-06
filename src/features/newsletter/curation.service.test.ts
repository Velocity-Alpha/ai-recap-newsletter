import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/prisma", () => ({
  prisma: {
    story: {
      findMany: findManyMock,
    },
  },
}));

vi.mock("@/src/server/observability", () => ({
  logServerInfo: vi.fn(),
  logServerError: vi.fn(),
}));

const findUnsentDraftsMock = vi.hoisted(() => vi.fn());

vi.mock("@/src/features/newsletter/unsent-drafts", () => ({
  findUnsentDrafts: findUnsentDraftsMock,
}));

import {
  cleanText,
  createDedupedOutline,
  createOutlineCandidateStories,
} from "@/src/features/newsletter/curation.service";

const OUTLINE_DATE = new Date("2026-06-09T00:00:00.000Z");

// Text has no ranking keywords, so importance alone sets the order: lower id ranks higher.
function candidateRow(id: number, category: string) {
  return {
    id,
    guid: `guid-${id}`,
    day: new Date("2026-06-08T00:00:00.000Z"),
    paywallDetected: null,
    error: null,
    headline: `Item ${id}`,
    url: `https://example.com/${id}`,
    summary: `Text ${id}`,
    category,
    source: "source",
    storyDetails: null,
    importanceScore: 100 - id,
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// 14 general (1–14), 7 research (21–27), 6 tools (31–36).
const POOL_ROWS = [
  ...range(1, 14).map((id) => candidateRow(id, "general")),
  ...range(21, 27).map((id) => candidateRow(id, "research")),
  ...range(31, 36).map((id) => candidateRow(id, "tools")),
];
const POOL_IDS = POOL_ROWS.map((row) => row.id);

function selectedIds(
  outline: Awaited<ReturnType<typeof createDedupedOutline>>,
  key: string
): number[] {
  const section = outline.candidate_sections.find((s) => s.key === key);
  return section ? section.selected.map((story) => story.id) : [];
}

function rankedIds(result: Awaited<ReturnType<typeof createOutlineCandidateStories>>): number[] {
  return result.rankedCandidates.map((story) => story.id);
}

describe("newsletter curation", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    // Calls in order: recently used stories, candidates, published URL lookup.
    findManyMock.mockResolvedValue([]);
    findUnsentDraftsMock.mockReset();
    findUnsentDraftsMock.mockResolvedValue([]);
  });

  describe("stories in an unsent draft", () => {
    const UNSENT = { date: "2026-06-08", storyIds: [1, 2] };

    function shownIds(outline: Awaited<ReturnType<typeof createDedupedOutline>>): number[] {
      return outline.candidate_sections.flatMap((section) =>
        [...section.selected, ...section.fill_ins].map((story) => story.id)
      );
    }

    it("holds them back by default and lists them as reference stories", async () => {
      findUnsentDraftsMock.mockResolvedValue([UNSENT]);
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);

      const { outline, rankedCandidates, referencedStories } =
        await createOutlineCandidateStories(OUTLINE_DATE);

      expect(findUnsentDraftsMock).toHaveBeenCalledWith("2026-06-09");
      expect(rankedCandidates.map((story) => story.id)).not.toContain(1);
      expect(rankedCandidates.map((story) => story.id)).not.toContain(2);
      expect(shownIds(outline)).not.toContain(1);
      // The AI duplicate check treats them as already covered.
      expect(referencedStories.map((story) => story.id)).toEqual([1, 2]);
      expect(outline.reference_stories).toEqual([
        expect.objectContaining({ id: 1, heldForDate: "2026-06-08", usedInPublicationDate: null }),
        expect.objectContaining({ id: 2, heldForDate: "2026-06-08", usedInPublicationDate: null }),
      ]);
      expect(outline.unsent_drafts).toEqual([
        { date: "2026-06-08", story_count: 2, reused: false },
      ]);
    });

    it("returns them to the pool when that draft is reused", async () => {
      findUnsentDraftsMock.mockResolvedValue([UNSENT]);
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);

      const { outline, referencedStories } = await createOutlineCandidateStories(OUTLINE_DATE, {
        reuseDraftDates: ["2026-06-08"],
      });

      expect(selectedIds(outline, "headlines")).toEqual([1, 2, 3]);
      expect(referencedStories).toEqual([]);
      expect(outline.unsent_drafts).toEqual([
        { date: "2026-06-08", story_count: 2, reused: true },
      ]);
    });

    it("drops another candidate that shares a held story's link", async () => {
      findUnsentDraftsMock.mockResolvedValue([{ date: "2026-06-08", storyIds: [1] }]);
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { ...candidateRow(1, "general"), url: "https://openai.com/index/gpt-6-for-everyone" },
        { ...candidateRow(2, "general"), url: "https://openai.com/index/gpt-6-for-everyone/" },
        candidateRow(3, "general"),
      ]);

      const result = await createOutlineCandidateStories(OUTLINE_DATE);

      expect(rankedIds(result)).toEqual([3]);
    });

    it("keeps holding them on the final board after the AI check", async () => {
      findUnsentDraftsMock.mockResolvedValue([UNSENT]);
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);

      const held = await createDedupedOutline(OUTLINE_DATE, POOL_IDS);
      expect(shownIds(held)).not.toContain(1);
      expect(held.unsent_drafts).toEqual([{ date: "2026-06-08", story_count: 2, reused: false }]);

      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);
      const reused = await createDedupedOutline(OUTLINE_DATE, POOL_IDS, {
        reuseDraftDates: ["2026-06-08"],
      });
      expect(selectedIds(reused, "headlines")).toEqual([1, 2, 3]);
    });

    it("counts only draft stories that this board could show", async () => {
      // 98 and 99 are queued for the draft but are not candidates for this date.
      findUnsentDraftsMock.mockResolvedValue([
        { date: "2026-06-08", storyIds: [1, 2, 99] },
        { date: "2026-06-07", storyIds: [98] },
      ]);
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);

      const { outline } = await createOutlineCandidateStories(OUTLINE_DATE);

      expect(outline.unsent_drafts).toEqual([
        { date: "2026-06-08", story_count: 2, reused: false },
      ]);
    });

    it("shows no notice when every earlier draft was sent", async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);

      const { outline } = await createOutlineCandidateStories(OUTLINE_DATE);

      expect(outline.unsent_drafts).toEqual([]);
    });
  });

  describe("same-URL duplicates", () => {
    it("keeps only the highest-ranked story when candidates share a cleaned URL", async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { ...candidateRow(1, "general"), url: "https://blog.google/models/gemini-4-carbon" },
        { ...candidateRow(2, "general"), url: "https://blog.google/models/gemini-4-carbon/?utm_source=x" },
        { ...candidateRow(3, "general"), url: "https://openai.com/index/gpt-6-for-everyone" },
      ]);

      const result = await createOutlineCandidateStories(OUTLINE_DATE);

      expect(rankedIds(result)).toEqual([1, 3]);
      expect(result.outline.candidate_map).not.toHaveProperty("2");
    });

    it("drops a candidate whose URL is already in a published issue", async () => {
      findManyMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidateRow(1, "general"), candidateRow(2, "general")])
        .mockResolvedValueOnce([{ url: "https://example.com/2/" }]);

      const result = await createOutlineCandidateStories(OUTLINE_DATE);

      expect(rankedIds(result)).toEqual([1]);
      const lookup = findManyMock.mock.calls[2][0];
      expect(lookup.where.usedInPublicationDate).toEqual({ not: null, lt: OUTLINE_DATE });
      expect(lookup.where.url.in).toEqual(
        expect.arrayContaining(["https://example.com/1", "https://example.com/2"])
      );
    });

    it("keeps different stories that share a homepage or index URL", async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { ...candidateRow(1, "general"), url: "https://qwen.ai/blog" },
        { ...candidateRow(2, "general"), url: "https://qwen.ai/blog" },
        { ...candidateRow(3, "tools"), url: "https://www.producthunt.com/products/claude" },
        { ...candidateRow(4, "tools"), url: "https://www.producthunt.com/products/claude" },
      ]);

      const result = await createOutlineCandidateStories(OUTLINE_DATE);

      expect(rankedIds(result)).toEqual([1, 2, 3, 4]);
    });

    it("leaves same-URL copies off the board after the AI duplicate check too", async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
        candidateRow(1, "general"),
        { ...candidateRow(2, "general"), url: "https://example.com/1" },
      ]);

      const outline = await createDedupedOutline(OUTLINE_DATE, [1, 2]);

      expect(outline.selected_story_ids).toEqual([1]);
    });
  });

  it("cleans markdown and URLs without injecting replacement placeholders", () => {
    expect(
      cleanText(
        "- **[OpenAI launches model](https://example.com)** read more at https://example.com"
      )
    ).toBe("OpenAI launches model");
  });

  it("maps reference stories using used_in_publication_date when present", async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: 101,
          guid: "guid-101",
          day: new Date("2026-06-05T00:00:00.000Z"),
          usedInPublicationDate: new Date("2026-06-08T00:00:00.000Z"),
          paywallDetected: "yes",
          headline: "Published story",
          url: "https://example.com/published",
          summary: "Summary",
          category: "general",
          source: "source",
          storyDetails: "details",
          importanceScore: 3,
        },
      ])
      .mockResolvedValueOnce([]);

    const { outline } = await createOutlineCandidateStories(
      new Date("2026-06-09T00:00:00.000Z")
    );

    expect(outline.reference_stories).toHaveLength(1);
    expect(outline.reference_stories[0]).toMatchObject({
      id: 101,
      usedInPublicationDate: "2026-06-08",
      paywall_detected: "yes",
      headline: "Published story",
      summary: "Summary",
    });
  });

  it("keeps usedInPublicationDate null when missing", async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: 202,
          guid: "guid-202",
          day: new Date("2026-06-04T00:00:00.000Z"),
          usedInPublicationDate: null,
          paywallDetected: null,
          headline: "Story without publication date",
          url: "https://example.com/no-date",
          summary: "Summary",
          category: "general",
          source: "source",
          storyDetails: "details",
          importanceScore: 3,
        },
      ])
      .mockResolvedValueOnce([]);

    const { outline } = await createOutlineCandidateStories(
      new Date("2026-06-09T00:00:00.000Z")
    );

    expect(outline.reference_stories).toHaveLength(1);
    expect(outline.reference_stories[0]).toMatchObject({
      id: 202,
      usedInPublicationDate: null,
      paywall_detected: "unknown",
      headline: "Story without publication date",
      summary: "Summary",
    });
  });

  describe("createDedupedOutline", () => {
    it("refills slots the duplicate check empties with the next-ranked kept stories", async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);
      const removed = new Set([1, 2, 21, 31]);

      const outline = await createDedupedOutline(
        OUTLINE_DATE,
        POOL_IDS.filter((id) => !removed.has(id))
      );

      expect(selectedIds(outline, "headlines")).toEqual([3, 4, 5]);
      expect(selectedIds(outline, "research")).toEqual([22, 23, 24, 25]);
      expect(selectedIds(outline, "tools")).toEqual([32, 33, 34]);
      expect(selectedIds(outline, "quickHits")).toEqual([9, 10, 11, 12, 13, 14]);
      expect(outline.selected_story_ids).toHaveLength(16);
    });

    it("never shows a story the duplicate check removed", async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);
      const removed = [1, 2, 21, 31];

      const outline = await createDedupedOutline(
        OUTLINE_DATE,
        POOL_IDS.filter((id) => !removed.includes(id))
      );

      const shownIds = outline.candidate_sections.flatMap((section) =>
        [...section.selected, ...section.fill_ins].map((story) => story.id)
      );
      for (const id of removed) {
        expect(shownIds).not.toContain(id);
        expect(outline.candidate_map).not.toHaveProperty(String(id));
        expect(outline.selected_story_ids).not.toContain(id);
      }
    });

    it("fills Quick Hits before Top Story fill-ins when general stories run short", async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);
      const keptGeneral = range(1, 10);

      const outline = await createDedupedOutline(OUTLINE_DATE, [
        ...keptGeneral,
        ...range(21, 27),
        ...range(31, 36),
      ]);
      const headlines = outline.candidate_sections.find((s) => s.key === "headlines")!;

      expect(selectedIds(outline, "headlines")).toEqual([1, 2, 3]);
      expect(headlines.fill_ins.map((story) => story.id)).toEqual([4]);
      expect(selectedIds(outline, "quickHits")).toEqual([5, 6, 7, 8, 9, 10]);
    });

    it("keeps today's layout when there are enough general stories", async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);

      const outline = await createDedupedOutline(OUTLINE_DATE, POOL_IDS);
      const headlines = outline.candidate_sections.find((s) => s.key === "headlines")!;
      const quickHits = outline.candidate_sections.find((s) => s.key === "quickHits")!;

      expect(selectedIds(outline, "headlines")).toEqual([1, 2, 3]);
      expect(headlines.fill_ins.map((story) => story.id)).toEqual([4, 5, 6]);
      expect(selectedIds(outline, "quickHits")).toEqual([7, 8, 9, 10, 11, 12]);
      expect(quickHits.fill_ins.map((story) => story.id)).toEqual([13, 14]);
    });

    it("leaves a section short only when its kept pool runs out", async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce(POOL_ROWS);
      const removedResearch = [21, 22, 23, 24, 25];

      const outline = await createDedupedOutline(
        OUTLINE_DATE,
        POOL_IDS.filter((id) => !removedResearch.includes(id))
      );

      expect(selectedIds(outline, "research")).toEqual([26, 27]);
      expect(selectedIds(outline, "headlines")).toEqual([1, 2, 3]);
    });
  });
});
