export const APPROVAL_DRAFT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CACHE_KEY_PREFIX = "approval_draft_";

export type ApprovalDraftData = {
  reference_stories: {
    id: number;
    day: string | null;
    headline: string;
    summary: string;
  }[];
  candidate_sections: {
    key: string;
    label: string;
    max: number;
    selected: { id: number; headline: string; summary: string }[];
    fill_ins: { id: number; headline: string; summary: string }[];
  }[];
  candidate_map: Record<
    string,
    {
      id: number;
      guid: string | null;
      day: string | null;
      headline: string | null;
      summary: string | null;
      story_details: string | null;
      category: string | null;
      source: string | null;
      url: string | null;
      importance_score: number | null;
      keyword_score: number;
      combined_score: number;
    }
  >;
};

type CacheStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type CachedEntry = {
  data: ApprovalDraftData;
  cachedAt: number;
};

function getApprovalDraftCacheKey(dateKey: string): string {
  return `${CACHE_KEY_PREFIX}${dateKey}`;
}

export function readApprovalDraftCache(
  dateKey: string,
  storage: CacheStorage = localStorage,
  now = Date.now()
): ApprovalDraftData | null {
  try {
    const raw = storage.getItem(getApprovalDraftCacheKey(dateKey));
    if (!raw) return null;

    const entry: CachedEntry = JSON.parse(raw);
    if (now - entry.cachedAt > APPROVAL_DRAFT_CACHE_TTL_MS) {
      storage.removeItem(getApprovalDraftCacheKey(dateKey));
      console.log("[approval:cache] expired", { dateKey });
      return null;
    }

    console.log("[approval:cache] hit", {
      dateKey,
      cachedAt: new Date(entry.cachedAt).toISOString(),
    });
    return entry.data;
  } catch {
    return null;
  }
}

export function writeApprovalDraftCache(
  dateKey: string,
  data: ApprovalDraftData,
  storage: CacheStorage = localStorage,
  now = Date.now()
): void {
  try {
    const entry: CachedEntry = { data, cachedAt: now };
    storage.setItem(getApprovalDraftCacheKey(dateKey), JSON.stringify(entry));
    console.log("[approval:cache] stored", { dateKey });
  } catch {
    // localStorage may be full or unavailable; this should not block approval.
  }
}
