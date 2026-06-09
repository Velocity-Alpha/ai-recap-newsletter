import { describe, expect, it, vi } from "vitest";

import {
  APPROVAL_OUTLINE_CACHE_TTL_MS,
  normalizeApprovalOutlineData,
  readApprovalOutlineCache,
  writeApprovalOutlineCache,
} from "@/src/features/newsletter/approval-outline-cache";
import { CANDIDATE_SECTION_CONFIGS } from "@/src/features/newsletter/section-config";

// Raw outline as the API might return it before normalization.
const rawOutlineData = {
  reference_stories: [],
  candidate_sections: [],
  candidate_map: {},
  selected_story_ids: [],
};

// What readApprovalOutlineCache should always return: raw stored data normalized to all four sections.
const normalizedOutlineData = {
  reference_stories: [],
  candidate_sections: CANDIDATE_SECTION_CONFIGS.map((s) => ({
    key: s.key,
    label: s.label,
    max: s.max,
    selected: [],
    fill_ins: [],
  })),
  candidate_map: {},
  selected_story_ids: [],
};

function createStorage() {
  const values = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("approval outline cache", () => {
  it("keeps approval outline data for seven days", () => {
    expect(APPROVAL_OUTLINE_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("stores raw data on write and returns normalized data on read", () => {
    const storage = createStorage();
    const now = Date.UTC(2026, 3, 30);

    // Write raw data (candidate_sections: []) — the cache stores as-is.
    writeApprovalOutlineCache("2026-04-30", rawOutlineData, storage, now);

    // The stored bytes should be the raw input, not normalized.
    const storedEntry = JSON.parse(storage.setItem.mock.calls[0][1] as string) as { data: unknown };
    expect((storedEntry.data as typeof rawOutlineData).candidate_sections).toEqual([]);

    // Read back: normalization is applied on the way out.
    expect(
      readApprovalOutlineCache("2026-04-30", storage, now + APPROVAL_OUTLINE_CACHE_TTL_MS - 1)
    ).toEqual(normalizedOutlineData);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("removes cached approval outline data after seven days", () => {
    const storage = createStorage();
    const now = Date.UTC(2026, 3, 30);

    writeApprovalOutlineCache("2026-04-30", rawOutlineData, storage, now);

    expect(
      readApprovalOutlineCache(
        "2026-04-30",
        storage,
        now + APPROVAL_OUTLINE_CACHE_TTL_MS + 1
      )
    ).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith("approval_outline_2026-04-30");
  });
});

describe("normalizeApprovalOutlineData", () => {
  it("expands an empty candidate_sections array to all four default sections", () => {
    expect(normalizeApprovalOutlineData(rawOutlineData).candidate_sections).toEqual(
      normalizedOutlineData.candidate_sections
    );
  });

  it("backfills missing sections while preserving the sections that are present", () => {
    const result = normalizeApprovalOutlineData({
      ...rawOutlineData,
      candidate_sections: [
        {
          key: "headlines",
          label: "Top Stories",
          max: 3,
          selected: [{ id: 1, headline: "Lead story", summary: "Summary" }],
          fill_ins: [{ id: 2, headline: "Fill story", summary: "Fill summary" }],
        },
      ],
    });

    expect(result.candidate_sections).toEqual([
      {
        key: "headlines",
        label: "Top Stories",
        max: 3,
        selected: [{ id: 1, headline: "Lead story", summary: "Summary" }],
        fill_ins: [{ id: 2, headline: "Fill story", summary: "Fill summary" }],
      },
      { key: "research", label: "Research & Analysis", max: 4, selected: [], fill_ins: [] },
      { key: "tools", label: "Tools", max: 3, selected: [], fill_ins: [] },
      { key: "quickHits", label: "Quick Hits", max: 6, selected: [], fill_ins: [] },
    ]);
  });

  it("preserves server-provided label, max, selected, and fill_ins for all four sections", () => {
    const fullSections = [
      {
        key: "headlines",
        label: "Top Stories",
        max: 3,
        selected: [{ id: 10, headline: "H1", summary: "S1" }],
        fill_ins: [],
      },
      {
        key: "research",
        label: "Research & Analysis",
        max: 4,
        selected: [{ id: 20, headline: "R1", summary: "S2" }],
        fill_ins: [{ id: 21, headline: "R2", summary: "S3" }],
      },
      {
        key: "tools",
        label: "Tools",
        max: 3,
        selected: [],
        fill_ins: [],
      },
      {
        key: "quickHits",
        label: "Quick Hits",
        max: 6,
        selected: [{ id: 30, headline: "Q1", summary: "S4" }],
        fill_ins: [],
      },
    ];

    const result = normalizeApprovalOutlineData({
      ...rawOutlineData,
      candidate_sections: fullSections,
    });

    // Shape must be identical to what the server sent.
    expect(result.candidate_sections).toEqual(fullSections);
  });

  it("passes non-section fields through unchanged", () => {
    const referenceStories = [
      {
        id: 99,
        usedInPublicationDate: "2026-05-01",
        headline: "Ref",
        summary: "Ref summary",
      },
    ];
    const candidateMap = { "1": { id: 1, guid: null, day: null, headline: "X", summary: null, story_details: null, category: null, source: null, url: null, importance_score: null, keyword_score: 0, combined_score: 0 } };

    const result = normalizeApprovalOutlineData({
      reference_stories: referenceStories,
      candidate_sections: [],
      candidate_map: candidateMap,
      selected_story_ids: [1],
    });

    expect(result.reference_stories).toEqual(referenceStories);
    expect(result.candidate_map).toEqual(candidateMap);
    expect(result.selected_story_ids).toEqual([1]);
  });
});
