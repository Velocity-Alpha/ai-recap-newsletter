import type { AlsoFrom, RepeatOf } from "@/src/features/newsletter/board-repeats";
import { CANDIDATE_SECTION_CONFIGS, type SectionKey } from "@/src/features/newsletter/section-config";
import type { SimilarStory } from "@/src/pipeline/repeats/repeat-rules";

export const APPROVAL_OUTLINE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// v2: boards built by the repeat check (#90). Boards cached before it are not read.
const CACHE_KEY_PREFIX = "approval_outline_v2_";

export type ApprovalOutlineData = {
  reference_stories: {
    id: number;
    usedInPublicationDate: string | null;
    heldForDate?: string | null;
    paywall_detected: "yes" | "no" | "unknown" | "error";
    error?: string | null;
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
      // Every newsletter that covered the story (#58). Missing on older cached boards.
      sources?: string[];
      // Duplicates merged into this story by the repeat check.
      also_from?: AlsoFrom[];
      // Similar stories already published, held, or excluded. The board shows them as a label.
      similar_to?: SimilarStory[];
      url: string | null;
      importance_score: number | null;
      paywall_detected?: "yes" | "no" | "unknown" | "error";
      error?: string | null;
      keyword_score: number;
      combined_score: number;
    }
  >;
  selected_story_ids: number[];
  // Candidates the repeat check removed. Their full stories are in candidate_map, so the owner can restore them.
  repeats_removed: { story: { id: number; headline: string | null }; repeat_of: RepeatOf; section: SectionKey }[];
  // True when the repeat check did not finish for some candidates.
  repeat_check_incomplete?: boolean;
  // The lead the board pre-sets (#58). Missing on boards cached before it.
  proposed_lead_id?: number | null;
  // Why the AI lead pick chose that lead. Null while the board shows the scored lead.
  proposed_lead_reason?: string | null;
  // Optional: boards cached before this field existed do not have it.
  unsent_drafts?: UnsentDraftNotice[];
  // Highest candidate story id the server saw when it built the board. Missing on older cached boards.
  candidate_marker?: number | null;
};

export type UnsentDraftNotice = {
  date: string;
  story_count: number;
  reused: boolean;
};

type CacheStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type CachedEntry = {
  data: ApprovalOutlineData;
  cachedAt: number;
  // Set once the owner changes anything on this board. A rebuilt board starts without it.
  edited?: boolean;
};

export function normalizeApprovalOutlineData(data: ApprovalOutlineData): ApprovalOutlineData {
  const sectionsByKey = new Map(data.candidate_sections.map((section) => [section.key, section]));
  const knownKeys = new Set<string>(CANDIDATE_SECTION_CONFIGS.map((s) => s.key));

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
    unsent_drafts: data.unsent_drafts ?? [],
  };
}

/** Cache id for a board: the date, plus any unsent drafts it reuses. */
export function approvalOutlineCacheId(dateKey: string, reuseDraftDates: readonly string[]): string {
  return reuseDraftDates.length > 0 ? `${dateKey}_reuse_${reuseDraftDates.join(",")}` : dateKey;
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

function readEntry(dateKey: string, storage: CacheStorage): CachedEntry | null {
  try {
    const raw = storage.getItem(getApprovalOutlineCacheKey(dateKey));
    return raw ? (JSON.parse(raw) as CachedEntry) : null;
  } catch {
    return null;
  }
}

export function isApprovalOutlineCacheEdited(
  dateKey: string,
  storage: CacheStorage = localStorage
): boolean {
  return readEntry(dateKey, storage)?.edited === true;
}

/** Records that the owner changed the cached board, so newer stories do not rebuild it unasked. */
export function markApprovalOutlineCacheEdited(
  dateKey: string,
  storage: CacheStorage = localStorage
): void {
  const entry = readEntry(dateKey, storage);
  if (!entry || entry.edited) return;
  try {
    storage.setItem(getApprovalOutlineCacheKey(dateKey), JSON.stringify({ ...entry, edited: true }));
  } catch {
    // localStorage may be full or unavailable; this should not block approval.
  }
}

export function clearApprovalOutlineCache(
  dateKey: string,
  storage: CacheStorage = localStorage
): void {
  try {
    storage.removeItem(getApprovalOutlineCacheKey(dateKey));
  } catch {
    // localStorage may be unavailable; nothing to clear then.
  }
}

export type CachedOutlineAction = "keep" | "rebuild" | "offer-rebuild";

/**
 * What to do with a cached board once the server reports its current candidate marker.
 * Newer stories rebuild an unchanged board; a changed board keeps the owner's work and offers a rebuild.
 * `cachedMarker` is undefined for boards cached before markers existed: those rebuild only when unchanged.
 */
export function cachedOutlineAction({
  cachedMarker,
  currentMarker,
  edited,
}: {
  cachedMarker: number | null | undefined;
  currentMarker: number | null;
  edited: boolean;
}): CachedOutlineAction {
  if (cachedMarker === undefined) return edited ? "keep" : "rebuild";

  const hasNewerStories =
    currentMarker !== null && (cachedMarker === null || currentMarker > cachedMarker);
  if (!hasNewerStories) return "keep";
  return edited ? "offer-rebuild" : "rebuild";
}
