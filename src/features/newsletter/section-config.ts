/**
 * Canonical editorial section configuration shared between the curation
 * pipeline (server) and the approval UI/cache (client).
 *
 * This is the single source of truth for section keys, display labels, and
 * selected-story limits. Both curation.service and approval-outline-cache
 * import from here so they can never silently drift apart.
 */
export const CANDIDATE_SECTION_CONFIGS = [
  { key: "headlines", label: "Top Stories", max: 3 },
  { key: "research", label: "Research & Analysis", max: 4 },
  { key: "tools", label: "Tools", max: 3 },
  { key: "quickHits", label: "Quick Hits", max: 6 },
] as const satisfies ReadonlyArray<{ key: string; label: string; max: number }>;

export type SectionKey = (typeof CANDIDATE_SECTION_CONFIGS)[number]["key"];
