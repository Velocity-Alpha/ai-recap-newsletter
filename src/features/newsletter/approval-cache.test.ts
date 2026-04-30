import { describe, expect, it, vi } from "vitest";

import {
  APPROVAL_DRAFT_CACHE_TTL_MS,
  readApprovalDraftCache,
  writeApprovalDraftCache,
} from "@/src/features/newsletter/approval-cache";

const draftData = {
  reference_stories: [],
  candidate_sections: [],
  candidate_map: {},
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

describe("approval draft cache", () => {
  it("keeps approval draft data for seven days", () => {
    expect(APPROVAL_DRAFT_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("returns cached approval draft data before the seven-day expiry", () => {
    const storage = createStorage();
    const now = Date.UTC(2026, 3, 30);

    writeApprovalDraftCache("2026-04-30", draftData, storage, now);

    expect(
      readApprovalDraftCache(
        "2026-04-30",
        storage,
        now + APPROVAL_DRAFT_CACHE_TTL_MS - 1
      )
    ).toEqual(draftData);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("removes cached approval draft data after seven days", () => {
    const storage = createStorage();
    const now = Date.UTC(2026, 3, 30);

    writeApprovalDraftCache("2026-04-30", draftData, storage, now);

    expect(
      readApprovalDraftCache(
        "2026-04-30",
        storage,
        now + APPROVAL_DRAFT_CACHE_TTL_MS + 1
      )
    ).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith("approval_draft_2026-04-30");
  });
});
