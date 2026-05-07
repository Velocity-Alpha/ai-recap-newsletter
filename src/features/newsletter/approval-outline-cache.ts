import { CANDIDATE_SECTION_CONFIGS } from "@/src/features/newsletter/section-config";

export const APPROVAL_OUTLINE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CACHE_KEY_PREFIX = "approval_outline_";

export type ApprovalOutlineData = {
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
  selected_story_ids: number[];
};

type CacheStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type CachedEntry = {
  data: ApprovalOutlineData;
  cachedAt: number;
};

export function normalizeApprovalOutlineData(data: ApprovalOutlineData): ApprovalOutlineData {
  const sectionsByKey = new Map(data.candidate_sections.map((section) => [section.key, section]));
  const knownKeys = new Set(CANDIDATE_SECTION_CONFIGS.map((s) => s.key));

  const knownSections = CANDIDATE_SECTION_CONFIGS.map((defaultSection) => {
    const existingSection = sectionsByKey.get(defaultSection.key);
    return {
      key: defaultSection.key as string,
      label: existingSection?.label ?? defaultSection.label,
      max: existingSection?.max ?? defaultSection.max,
      selected: existingSection?.selected ?? [],
      fill_ins: existingSection?.fill_ins ?? [],
    };
  });

  // Preserve any sections the server sent that this client doesn't recognise yet
  // (e.g. a new section deployed server-side before the next client build).
  const unknownSections = data.candidate_sections.filter((s) => !knownKeys.has(s.key));

  return {
    ...data,
    candidate_sections: [...knownSections, ...unknownSections],
  };
}

function getApprovalOutlineCacheKey(dateKey: string): string {
  return `${CACHE_KEY_PREFIX}${dateKey}`;
}

export function readApprovalOutlineCache(
  dateKey: string,
  storage: CacheStorage = localStorage,
  now = Date.now()
): ApprovalOutlineData | null {
  try {
    const raw = storage.getItem(getApprovalOutlineCacheKey(dateKey));
    if (!raw) return null;

    const entry: CachedEntry = JSON.parse(raw);
    if (now - entry.cachedAt > APPROVAL_OUTLINE_CACHE_TTL_MS) {
      storage.removeItem(getApprovalOutlineCacheKey(dateKey));
      console.log("[approval:cache] expired", { dateKey });
      return null;
    }

    console.log("[approval:cache] hit", {
      dateKey,
      cachedAt: new Date(entry.cachedAt).toISOString(),
    });
    return normalizeApprovalOutlineData(entry.data);
  } catch {
    return null;
  }
}

export function writeApprovalOutlineCache(
  dateKey: string,
  data: ApprovalOutlineData,
  storage: CacheStorage = localStorage,
  now = Date.now()
): void {
  try {
    // Store the raw API response as-is. Normalization happens on read so that
    // any future changes to section defaults are applied at the point of
    // consumption, not silently baked into the stored bytes.
    const entry: CachedEntry = { data, cachedAt: now };
    storage.setItem(getApprovalOutlineCacheKey(dateKey), JSON.stringify(entry));
    console.log("[approval:cache] stored", { dateKey });
  } catch {
    // localStorage may be full or unavailable; this should not block approval.
  }
}
