import { describe, expect, it, vi } from "vitest";

import {
  APPROVAL_OUTLINE_CACHE_TTL_MS,
  readApprovalOutlineCache,
  writeApprovalOutlineCache,
} from "@/src/features/newsletter/approval-outline-cache";

const outlineData = {
  reference_stories: [],
  candidate_sections: [],
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

  it("returns cached approval outline data before the seven-day expiry", () => {
    const storage = createStorage();
    const now = Date.UTC(2026, 3, 30);

    writeApprovalOutlineCache("2026-04-30", outlineData, storage, now);

    expect(
      readApprovalOutlineCache(
        "2026-04-30",
        storage,
        now + APPROVAL_OUTLINE_CACHE_TTL_MS - 1
      )
    ).toEqual(outlineData);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("removes cached approval outline data after seven days", () => {
    const storage = createStorage();
    const now = Date.UTC(2026, 3, 30);

    writeApprovalOutlineCache("2026-04-30", outlineData, storage, now);

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
