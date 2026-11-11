import { prisma } from "@/src/server/prisma";
import { logServerError, logServerInfo } from "@/src/server/observability";
import { CANDIDATE_SECTION_CONFIGS, type SectionKey } from "@/src/features/newsletter/section-config";
import { storyUrlKey } from "@/src/features/newsletter/story-url";
import { findUnsentDrafts } from "@/src/features/newsletter/unsent-drafts";
import { moveLeadToTopStories, proposeLeadStory, storySources } from "@/src/features/newsletter/lead-story";
import {
  applyBoardRepeats,
  type AlsoFrom,
  type BoardRepeats,
  type RestorableRepeat,
} from "@/src/features/newsletter/board-repeats";
import type { SimilarStory } from "@/src/pipeline/repeats/repeat-rules";

export interface StoryRecord {
  id: number;
  guid: string | null;
  day: Date | string | null;
  headline: string | null;
  summary: string | null;
  story_details: string | null;
  category: string | null;
  source: string | null;
  /**
   * Every newsletter that covered the story (#58): its stored mentions, plus the sources of same-URL copies
   * the board dropped. Unset when none were loaded; `storySources` then falls back to `source`.
   */
  sources?: string[];
  url: string | null;
  importance_score: number | null;
  paywall_detected?: "yes" | "no" | "unknown" | "error";
  error?: string | null;
  used_in_publication_date?: Date | string | null;
  /** Set while the story waits in an unsent draft for this issue date. */
  held_for_date?: string | null;
  /** Duplicates merged into this story by the repeat check (#90). */
  also_from?: AlsoFrom[];
  /** Earlier or excluded stories this one looks like, at most 3 (#90). */
  similar_to?: SimilarStory[];
}

export interface ProcessedStory extends StoryRecord {
  keyword_score: number;
  combined_score: number;
}

interface CandidateSection {
  key: string;
  label: string;
  max: number;
  selected: Array<{ id: number; headline: string; summary: string }>;
  fill_ins: Array<{ id: number; headline: string; summary: string }>;
}

interface ReferenceStory {
  id: number;
  usedInPublicationDate: string | null;
  /** Issue date of the unsent draft that holds this story, if any. */
  heldForDate: string | null;
  paywall_detected: "yes" | "no" | "unknown" | "error";
  error?: string | null;
  headline: string;
  summary: string;
}

export interface ApprovalOutlineData {
  reference_stories: ReferenceStory[];
  candidate_sections: CandidateSection[];
  candidate_map: Record<
    string,
    StoryRecord & { keyword_score: number; combined_score: number }
  >;
  selected_story_ids: number[];
  /**
   * The selected story the board pre-sets as the lead (#58, lead-story.ts), or null when none is eligible.
   * Absent on boards cached before #58.
   */
  proposed_lead_id?: number | null;
  /** Why the AI lead pick chose the proposed lead. Absent when the score chose it. */
  proposed_lead_reason?: string | null;
  /** Earlier drafts that were never sent, and whether their stories are back in this board's pool. */
  unsent_drafts: UnsentDraftNotice[];
  /**
   * Highest story id in the candidate window when the board was built, or null if the window was empty.
   * The board compares it with `getCandidateMarker` to spot stories that arrived later.
   */
  candidate_marker: number | null;
  /**
   * Candidates the repeat check removed, with the story each repeats and the section a restored copy goes to.
   * They are in `candidate_map` too.
   */
  repeats_removed: RestorableRepeat<ProcessedStory>[];
  /** True when the repeat check did not finish for some candidates. */
  repeat_check_incomplete?: boolean;
}

/** What the repeat check took off the board. */
type BoardRepeatResult = Omit<BoardRepeats<ProcessedStory>, "heads">;

/** The parts of a board that do not come from the ranked stories. */
export interface OutlineExtras {
  unsentDrafts?: UnsentDraftNotice[];
  candidateMarker?: number | null;
  repeats?: BoardRepeatResult;
}

export interface UnsentDraftNotice {
  date: string;
  story_count: number;
  reused: boolean;
}

export interface OutlineOptions {
  /** Unsent draft dates whose stories go back into the pool instead of being held. */
  reuseDraftDates?: Iterable<string>;
}

function normalizePaywallDetected(value: string | null | undefined): "yes" | "no" | "unknown" | "error" {
  const normalized = String(value ?? "").toLowerCase().trim();
  if (normalized === "yes") return "yes";
  if (normalized === "no") return "no";
  if (normalized === "error") return "error";
  return "unknown";
}

// Configuration — derived from the shared section-config so keys/labels/limits stay in sync with the UI.
const SECTION_LIMITS = Object.fromEntries(
  CANDIDATE_SECTION_CONFIGS.map((s) => [s.key, s.max])
) as Record<SectionKey, number>;
const SECTION_LABELS = Object.fromEntries(
  CANDIDATE_SECTION_CONFIGS.map((s) => [s.key, s.label])
) as Record<SectionKey, string>;
const FILL_IN_LIMIT = 3;

// Patterns to remove from text
const REMOVAL_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /sponsored by[^.!?]*[.!?]/gi, replacement: "" },
  { pattern: /together with[^.!?]*[.!?]/gi, replacement: "" },
  { pattern: /presented by[^.!?]*[.!?]/gi, replacement: "" },
  { pattern: /partner content[^.!?]*[.!?]/gi, replacement: "" },
  { pattern: /paid partnership[^.!?]*[.!?]/gi, replacement: "" },
  { pattern: /in partnership with[^.!?]*[.!?]/gi, replacement: "" },
  { pattern: /brought to you by[^.!?]*[.!?]/gi, replacement: "" },
  { pattern: /tldr[^.!?]*[.!?]/gi, replacement: "" },
  { pattern: /ai breakfast[^.!?]*[.!?]/gi, replacement: "" },
  { pattern: /rundown(?: ai)?[^.!?]*[.!?]/gi, replacement: "" },
  { pattern: /source:\s*[^.!?\\n]+(?:[.!?]|$)/gi, replacement: "" },
  { pattern: /via\s*[^.!?\\n]+(?:[.!?]|$)/gi, replacement: "" },
  { pattern: /as reported by[^.!?\\n]+[.!?]/gi, replacement: "" },
  { pattern: /\[([^\]]+)\]\(([^)]+)\)/g, replacement: "$1" },
  { pattern: /https?:\/\/[^\s]+/g, replacement: "" },
  { pattern: /www\.[^\s]+/g, replacement: "" },
  { pattern: /learn more\s*(?:on|at|via|about)?\s*[^.!?\\n]*[.!?]?/gi, replacement: "" },
  { pattern: /read more\s*(?:on|at|via|about)?\s*[^.!?\\n]*[.!?]?/gi, replacement: "" },
  { pattern: /read more\s*(?:on|at|via|about)?/gi, replacement: "" },
  { pattern: /check it out\s*(?:on|at|via)?\s*[^.!?\\n]*[.!?]?/gi, replacement: "" },
  { pattern: /visit\s*(?:our)?\s*(?:website|site)\s*[^.!?\\n]*[.!?]?/gi, replacement: "" },
  { pattern: /for more information\s*[^.!?\\n]*[.!?]?/gi, replacement: "" },
  { pattern: /`/g, replacement: "" },
  { pattern: /\*\*/g, replacement: "" },
  { pattern: /\*/g, replacement: "" },
  { pattern: /#+\s*/g, replacement: "" },
  { pattern: /^\s*[-•*]\s+/gm, replacement: "" },
  { pattern: /\n\s*[-•*]\s+/g, replacement: "\n" },
];

// Keywords for scoring
const TOOL_KEYWORDS = [
  "app",
  "tool",
  "api",
  "platform",
  "software",
  "launch",
  "release",
  "available",
  "beta",
  "feature",
  "plugin",
  "extension",
  "integration",
  "download",
  "install",
  "access",
  "try",
  "use",
  "demo",
  "product",
  "service",
  "application",
  "system",
  "interface",
];

const RESEARCH_KEYWORDS = [
  "research",
  "study",
  "paper",
  "analysis",
  "findings",
  "breakthrough",
  "discover",
  "scientist",
  "university",
  "published",
  "journal",
  "academic",
  "experiment",
  "data shows",
  "researchers",
  "peer-reviewed",
  "survey",
  "report",
];

/**
 * Normalizes scraped newsletter text before scoring, comparing, and displaying it.
 *
 * Source feeds often include sponsor blurbs, markdown syntax, links, and
 * newsletter-specific boilerplate. Cleaning here keeps ranking focused on the
 * actual story content.
 */
export function cleanText(value: string | null | undefined): string {
  if (!value) return "";

  let cleaned = String(value);

  for (const { pattern, replacement } of REMOVAL_PATTERNS) {
    cleaned = cleaned.replace(pattern, replacement);
  }

  cleaned = cleaned.replace(/…/g, "");
  cleaned = cleaned.replace(/\.{2,}/g, ".");
  cleaned = cleaned.replace(/—|–/g, "-");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/\s+([.,;:!?])/g, "$1");
  cleaned = cleaned.replace(/[.,;:!?-]+$/g, ".");
  cleaned = cleaned.replace(/^\\.+/, "").trim();

  return cleaned;
}

/**
 * Scores a story for editorially useful AI-news keywords.
 *
 * This is a lightweight boost layered on top of `importance_score`; it helps
 * surface tools, launches, research, and analysis without making category
 * labels the only signal.
 */
function calculateKeywordScore(story: {
  headline: string | null;
  summary: string | null;
  story_details: string | null;
}): number {
  const text = `${story.headline || ""} ${story.summary || ""} ${story.story_details || ""}`.toLowerCase();
  let score = 0;

  for (const keyword of [...TOOL_KEYWORDS, ...RESEARCH_KEYWORDS]) {
    if (text.includes(keyword)) score += 1;
  }

  return score;
}

/**
 * Collapses source category labels into the buckets used by the approval UI.
 */
export function normalizeCategory(category: string | null | undefined): string {
  const normalized = String(category ?? "").toLowerCase().trim();
  if (normalized === "research" || normalized === "analysis") return "research";
  if (normalized === "tools" || normalized === "tool") return "tools";
  return "general";
}

/** The first section a story of this category can fill: general stories go to Top Stories. */
function sectionForCategory(category: string | null): SectionKey {
  const bucket = normalizeCategory(category);
  return bucket === "research" || bucket === "tools" ? bucket : "headlines";
}

/**
 * Converts a full story row into the compact option shape shown in a section.
 */
function toOption(story: StoryRecord & { keyword_score: number }) {
  return {
    id: story.id,
    headline: cleanText(story.headline),
    summary: cleanText(story.summary),
  };
}

/**
 * Converts previously published stories into the reference format returned to
 * the approval screen and supplied to the AI lead pick.
 */
function toReferenceStory(story: StoryRecord): ReferenceStory {
  const raw = story.used_in_publication_date;
  const publicationDateStr =
    raw instanceof Date
      ? raw.toISOString().slice(0, 10)
      : typeof raw === "string"
        ? raw.slice(0, 10)
        : null;
  return {
    id: story.id,
    usedInPublicationDate: publicationDateStr,
    heldForDate: story.held_for_date ?? null,
    paywall_detected: normalizePaywallDetected(story.paywall_detected),
    error: story.error,
    headline: cleanText(story.headline) || "Untitled story",
    summary: cleanText(story.summary),
  };
}

/**
 * Formats dates as YYYY-MM-DD for date-window SQL filters.
 */
function toDateOnlyIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toUtcDateFromDateOnly(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

function dedupeStoriesByGuid(stories: StoryRecord[]): StoryRecord[] {
  const seenKeys = new Set<string>();
  const dedupedStories: StoryRecord[] = [];

  for (const story of stories) {
    const dedupeKey = story.guid ?? String(story.id);
    if (seenKeys.has(dedupeKey)) continue;

    seenKeys.add(dedupeKey);
    dedupedStories.push(story);
  }

  return dedupedStories;
}

/**
 * Loads recently used stories for the requested publication date.
 *
 * These are not candidates. The sidebar lists them and the AI lead pick reads
 * their headlines. The repeat check uses its own, longer window.
 */
async function getReferencedStories(date: Date): Promise<StoryRecord[]> {
  const dateOnly = toDateOnlyIso(date);
  const targetDate = toUtcDateFromDateOnly(dateOnly);
  const lookbackDays = date.getUTCDay() === 1 ? 3 : 2;
  const lookbackStartDate = new Date(targetDate);
  lookbackStartDate.setUTCDate(lookbackStartDate.getUTCDate() - lookbackDays);

  logServerInfo("approval.outline.fetch.referenced.query", {
    requestedDateIso: date.toISOString(),
    dateOnly,
    lookbackDays,
  });

  const referencedStories = await prisma.story.findMany({
    where: {
      usedInPublicationDate: {
        lte: targetDate,
        gte: lookbackStartDate,
      },
      excludeFromCandidates: false,
    },
    select: {
      id: true,
      guid: true,
      day: true,
      usedInPublicationDate: true,
      paywallDetected: true,
      error: true,
      headline: true,
      url: true,
      summary: true,
      category: true,
      source: true,
      storyDetails: true,
      importanceScore: true,
    },
    orderBy: [{ usedInPublicationDate: "desc" }, { id: "desc" }],
  });

  const referencedStoryRecords = dedupeStoriesByGuid(
    referencedStories.map((story) => ({
      id: Number(story.id),
      guid: story.guid,
      day: story.day,
      used_in_publication_date: story.usedInPublicationDate,
      paywall_detected: normalizePaywallDetected(story.paywallDetected),
      error: story.error,
      headline: story.headline,
      summary: story.summary,
      story_details: story.storyDetails,
      category: story.category,
      source: story.source,
      url: story.url,
      importance_score: story.importanceScore,
    }))
  );

  logServerInfo("approval.outline.fetch.referenced.rows", {
    rowCount: referencedStoryRecords.length,
  });

  return referencedStoryRecords;
}

/**
 * The candidate window: eligible unpublished candidate stories for the approval outline.
 *
 * The SQL filter keeps the candidate pool recent, sufficiently important,
 * usable as a source link, and not already consumed by a publication.
 */
function candidateStoriesWhere(date: Date) {
  const targetDate = toUtcDateFromDateOnly(toDateOnlyIso(date));
  const candidateWindowStartDate = new Date(targetDate);
  candidateWindowStartDate.setUTCDate(candidateWindowStartDate.getUTCDate() - 3);

  return {
    importanceScore: {
      gte: 2,
    },
    day: {
      not: null,
      lte: targetDate,
      gte: candidateWindowStartDate,
    },
    usedInPublicationDate: null,
    excludeFromCandidates: false,
    AND: [
      {
        url: {
          not: null,
        },
      },
      {
        url: {
          not: "",
        },
      },
    ],
    NOT: {
      OR: [
        { url: { contains: "tldr", mode: "insensitive" as const } },
        { url: { contains: "rundown", mode: "insensitive" as const } },
        { url: { contains: "beehiiv", mode: "insensitive" as const } },
      ],
    },
  };
}

/** Loads the stories in the candidate window for the approval outline. */
async function getCandidateStories(date: Date): Promise<StoryRecord[]> {
  const dateOnly = toDateOnlyIso(date);

  logServerInfo("approval.outline.fetch.candidates.query", {
    requestedDateIso: date.toISOString(),
    dateOnly,
  });

  const candidateStories = await prisma.story.findMany({
    where: candidateStoriesWhere(date),
    select: {
      id: true,
      guid: true,
      day: true,
      paywallDetected: true,
      error: true,
      headline: true,
      url: true,
      summary: true,
      category: true,
      source: true,
      storyDetails: true,
      importanceScore: true,
    },
    orderBy: [{ day: "desc" }, { id: "desc" }],
  });

  const candidateStoryRecords = dedupeStoriesByGuid(
    candidateStories.map((story) => ({
        id: Number(story.id),
        guid: story.guid,
        day: story.day,
        paywall_detected: normalizePaywallDetected(story.paywallDetected),
        error: story.error,
        headline: story.headline,
        summary: story.summary,
        story_details: story.storyDetails,
        category: story.category,
        source: story.source,
        url: story.url,
        importance_score: story.importanceScore,
      }))
  );

  logServerInfo("approval.outline.fetch.candidates.rows", {
    rowCount: candidateStoryRecords.length,
  });

  const mentions = await getStoryMentions(candidateStoryRecords.map((story) => story.id));
  return candidateStoryRecords.map((story) => ({
    ...story,
    sources: storySources({ source: story.source, sources: mentions.get(story.id) }),
  }));
}

/**
 * The newsletters ingestion recorded for each story (`story_sources`, #58). Coverage only shapes the proposed
 * lead, so a failed read (for example before the table's migration) logs and leaves each row's own source.
 */
async function getStoryMentions(storyIds: number[]): Promise<Map<number, string[]>> {
  const mentions = new Map<number, string[]>();
  if (storyIds.length === 0) return mentions;
  try {
    const rows = await prisma.storySource.findMany({
      where: { storyId: { in: storyIds } },
      select: { storyId: true, source: true },
    });
    for (const row of rows) mentions.set(row.storyId, [...(mentions.get(row.storyId) ?? []), row.source]);
  } catch (error) {
    logServerError("approval.outline.fetch.sources.failed", error, { storyCount: storyIds.length });
  }
  return mentions;
}

/**
 * The current candidate marker for a date: the highest story id in the candidate window, or null.
 * A light read the board uses to check whether a cached board missed newer stories.
 */
export async function getCandidateMarker(date: Date): Promise<number | null> {
  const result = await prisma.story.aggregate({
    where: candidateStoriesWhere(date),
    _max: { id: true },
  });
  return result._max.id ?? null;
}

function highestStoryId(stories: StoryRecord[]): number | null {
  return stories.reduce<number | null>(
    (max, story) => (max === null || story.id > max ? story.id : max),
    null
  );
}

/**
 * Cleans candidate text, calculates editorial keyword boosts, and sorts the
 * stories by combined quality signals.
 *
 * The returned order drives section selection later, so higher-ranked stories
 * are chosen before lower-ranked fill-ins.
 */
function processAndRankStories(
  stories: StoryRecord[]
): ProcessedStory[] {
  const processed = stories.map((story) => {
    const cleaned = {
      ...story,
      headline: cleanText(story.headline),
      summary: cleanText(story.summary),
      story_details: cleanText(story.story_details),
      importance_score: Number(story.importance_score ?? 0),
    };

    const keyword_score = calculateKeywordScore(cleaned);
    const combined_score =
      cleaned.importance_score + keyword_score;

    return {
      ...cleaned,
      keyword_score,
      combined_score,
    };
  });

  return processed.sort((a, b) => {
    const combinedDiff = b.combined_score - a.combined_score;
    if (combinedDiff !== 0) return combinedDiff;

    const importanceDiff = b.importance_score - a.importance_score;
    if (importanceDiff !== 0) return importanceDiff;

    return b.keyword_score - a.keyword_score;
  });
}

/**
 * Splits ranked, deduplicated stories into the section buckets used by the UI.
 */
function groupStoriesByCategory(stories: ProcessedStory[]): {
  research: ProcessedStory[];
  tools: ProcessedStory[];
  general: ProcessedStory[];
} {
  const research: ProcessedStory[] = [];
  const tools: ProcessedStory[] = [];
  const general: ProcessedStory[] = [];

  for (const story of stories) {
    const bucket = normalizeCategory(story.category);
    if (bucket === "research") {
      research.push(story);
    } else if (bucket === "tools") {
      tools.push(story);
    } else {
      general.push(story);
    }
  }

  return { research, tools, general };
}

/**
 * Builds the approval-board section payload from ranked category buckets.
 *
 * Each section has primary `selected` stories plus extra `fill_ins` that can
 * be promoted manually by an editor if they reject or swap a selected story.
 */
/**
 * Story pool assignments are intentional domain logic: headlines and quickHits
 * both draw from the general pool (with an offset between them), while research
 * and tools each have their own pool. This cannot be purely derived from
 * CANDIDATE_SECTION_CONFIGS, but keys are typed as SectionKey so adding a new
 * section to the config produces a compile-time exhaustiveness error here.
 */
function createSectionBlueprints(
  research: ProcessedStory[],
  tools: ProcessedStory[],
  general: ProcessedStory[]
): CandidateSection[] {
  // Headlines and Quick Hits share the general pool in rank order: Top Story
  // picks, Top Story fill-ins, Quick Hit picks, Quick Hit fill-ins. When the
  // pool is short, Top Story fill-ins shrink first so selected Quick Hit
  // slots are never left empty while a general story sits in a fill-in.
  const headlineFillInCount = Math.min(
    FILL_IN_LIMIT,
    Math.max(0, general.length - SECTION_LIMITS.headlines - SECTION_LIMITS.quickHits)
  );
  const quickHitsStart = SECTION_LIMITS.headlines + headlineFillInCount;
  const quickHitsEnd = quickHitsStart + SECTION_LIMITS.quickHits;

  const blueprints: Array<{
    key: SectionKey;
    label: string;
    max: number;
    selected: ProcessedStory[];
    fill_ins: ProcessedStory[];
  }> = [
    {
      key: "headlines",
      label: SECTION_LABELS.headlines,
      max: SECTION_LIMITS.headlines,
      selected: general.slice(0, SECTION_LIMITS.headlines),
      fill_ins: general.slice(SECTION_LIMITS.headlines, quickHitsStart),
    },
    {
      key: "research",
      label: SECTION_LABELS.research,
      max: SECTION_LIMITS.research,
      selected: research.slice(0, SECTION_LIMITS.research),
      fill_ins: research.slice(
        SECTION_LIMITS.research,
        SECTION_LIMITS.research + FILL_IN_LIMIT
      ),
    },
    {
      key: "tools",
      label: SECTION_LABELS.tools,
      max: SECTION_LIMITS.tools,
      selected: tools.slice(0, SECTION_LIMITS.tools),
      fill_ins: tools.slice(
        SECTION_LIMITS.tools,
        SECTION_LIMITS.tools + FILL_IN_LIMIT
      ),
    },
    {
      key: "quickHits",
      label: SECTION_LABELS.quickHits,
      max: SECTION_LIMITS.quickHits,
      selected: general.slice(quickHitsStart, quickHitsEnd),
      fill_ins: general.slice(quickHitsEnd, quickHitsEnd + FILL_IN_LIMIT),
    },
  ];

  return blueprints
    .map((section) => ({
      key: section.key,
      label: section.label,
      max: section.max,
      selected: section.selected.map(toOption),
      fill_ins: section.fill_ins.map(toOption),
    }));
}

/**
 * Builds the approval board from stories that are already ranked.
 *
 * Slots are filled in rank order from whatever is passed in. Pass only the
 * stories the repeat check kept, so each slot it empties is refilled with
 * the next-ranked kept story instead of staying empty.
 */
export function buildApprovalOutline(
  rankedStories: ProcessedStory[],
  referencedStories: StoryRecord[],
  { unsentDrafts = [], candidateMarker = null, repeats = { removed: [], incomplete: false } }: OutlineExtras = {}
): ApprovalOutlineData {
  const grouped = groupStoriesByCategory(rankedStories);

  logServerInfo("approval.outline.grouped", {
    researchCount: grouped.research.length,
    toolsCount: grouped.tools.length,
    generalCount: grouped.general.length,
  });

  // Create section blueprints
  const storyById = new Map<number, ProcessedStory>(
    rankedStories.map((story) => [story.id, story])
  );
  const proposedLead = proposeLeadStory(
    createSectionBlueprints(grouped.research, grouped.tools, grouped.general).map((section) => ({
      key: section.key,
      selected: section.selected.flatMap((option) => storyById.get(option.id) ?? []),
    }))
  );
  const candidate_sections = moveLeadToTopStories(
    createSectionBlueprints(grouped.research, grouped.tools, grouped.general),
    proposedLead
  );
  const proposed_lead_id = proposedLead?.id ?? null;

  // Build candidate map and selected IDs
  const candidate_map: Record<string, ProcessedStory> = {};
  const selected_story_ids = new Set<number>();

  for (const section of candidate_sections) {
    for (const story of section.selected) {
      const fullStory = storyById.get(story.id);
      if (fullStory) {
        candidate_map[String(story.id)] = fullStory;
        selected_story_ids.add(story.id);
      }
    }

    for (const story of section.fill_ins) {
      const fullStory = storyById.get(story.id);
      if (fullStory) {
        candidate_map[String(story.id)] = fullStory;
      }
    }
  }

  // Removed repeats can be restored on the board, so it needs their full story.
  for (const { story } of repeats.removed) candidate_map[String(story.id)] = story;

  logServerInfo("approval.outline.final", {
    sectionCount: candidate_sections.length,
    selectedStoryCount: selected_story_ids.size,
    proposedLeadId: proposed_lead_id,
  });

  return {
    reference_stories: referencedStories.map(toReferenceStory),
    candidate_sections,
    candidate_map,
    selected_story_ids: Array.from(selected_story_ids),
    proposed_lead_id,
    unsent_drafts: unsentDrafts,
    candidate_marker: candidateMarker,
    repeats_removed: repeats.removed.map((entry) => ({ ...entry, section: sectionForCategory(entry.story.category) })),
    ...(repeats.incomplete ? { repeat_check_incomplete: true } : {}),
  };
}

/**
 * Loads the cleaned URLs of candidates that already ran in a published issue,
 * in an issue before the requested date.
 */
async function getPublishedUrlKeys(
  date: Date,
  candidates: ProcessedStory[]
): Promise<Set<string>> {
  // Stored URLs are already cleaned, but a few keep a trailing slash or a
  // query, so look up the raw and slash forms too.
  const lookups = new Set<string>();
  for (const story of candidates) {
    const key = storyUrlKey(story.url);
    if (!key || !story.url) continue;
    lookups.add(key);
    lookups.add(`${key}/`);
    lookups.add(story.url);
  }
  if (lookups.size === 0) return new Set();

  const published = await prisma.story.findMany({
    where: {
      usedInPublicationDate: {
        not: null,
        lt: toUtcDateFromDateOnly(toDateOnlyIso(date)),
      },
      url: { in: Array.from(lookups) },
    },
    select: { url: true },
  });

  return new Set(
    published
      .map((story) => storyUrlKey(story.url))
      .filter((key): key is string => key !== null)
  );
}

/**
 * Removes candidates that repeat a URL: a copy of a higher-ranked candidate,
 * or a URL that already ran in a published issue. Pages that hold many
 * stories (homepages, index pages) are left to the repeat check.
 */
function removeUrlDuplicates(
  rankedCandidates: ProcessedStory[],
  publishedUrlKeys: ReadonlySet<string>
): { kept: ProcessedStory[]; sameUrlCount: number; publishedUrlCount: number } {
  const keptByKey = new Map<string, ProcessedStory>();
  const kept: ProcessedStory[] = [];
  let sameUrlCount = 0;
  let publishedUrlCount = 0;

  for (const story of rankedCandidates) {
    const key = storyUrlKey(story.url);
    if (key && publishedUrlKeys.has(key)) {
      publishedUrlCount += 1;
      continue;
    }
    const original = key ? keptByKey.get(key) : undefined;
    if (original) {
      // The copy's newsletter still covered the story: credit it to the one the board keeps.
      original.sources = storySources({
        source: original.source,
        sources: [...(original.sources ?? []), ...storySources(story)],
      });
      sameUrlCount += 1;
      continue;
    }
    const copy = { ...story };
    if (key) keptByKey.set(key, copy);
    kept.push(copy);
  }

  return { kept, sameUrlCount, publishedUrlCount };
}

/**
 * Loads the reference stories and the ranked candidate pool for a date.
 *
 * Stories in an earlier, unsent draft are held for that draft unless the
 * caller reuses it. Held stories leave the pool and count as references, so
 * the URL check and the repeat check also keep their repeats off this board.
 */
async function loadRankedCandidates(
  date: Date,
  options: OutlineOptions = {}
): Promise<{
  referencedStories: StoryRecord[];
  rankedCandidates: ProcessedStory[];
  unsentDrafts: UnsentDraftNotice[];
  candidateMarker: number | null;
  repeats: BoardRepeatResult;
}> {
  logServerInfo("approval.outline.create.start", { date: date.toISOString() });

  const [publishedReferences, candidateStories, drafts] = await Promise.all([
    getReferencedStories(date),
    getCandidateStories(date),
    findUnsentDrafts(toDateOnlyIso(date)),
  ]);

  const reused = new Set(options.reuseDraftDates ?? []);
  const heldForDate = new Map<number, string>();
  for (const draft of drafts) {
    if (reused.has(draft.date)) continue;
    for (const id of draft.storyIds) heldForDate.set(id, draft.date);
  }
  const heldStories = candidateStories
    .filter((story) => heldForDate.has(story.id))
    .map((story) => ({ ...story, held_for_date: heldForDate.get(story.id) }));
  const pool = candidateStories.filter((story) => !heldForDate.has(story.id));
  const referencedStories = [...publishedReferences, ...heldStories];
  // Count only draft stories this board could show. Older or excluded ones
  // are not candidates either way, so a draft with none of them needs no notice.
  const candidateIds = new Set(candidateStories.map((story) => story.id));
  const unsentDrafts = drafts.flatMap((draft) => {
    const storyCount = draft.storyIds.filter((id) => candidateIds.has(id)).length;
    return storyCount > 0
      ? [{ date: draft.date, story_count: storyCount, reused: reused.has(draft.date) }]
      : [];
  });

  logServerInfo("approval.outline.fetch.result", {
    referencedCount: publishedReferences.length,
    candidateCount: candidateStories.length,
    heldCount: heldStories.length,
    unsentDraftDates: unsentDrafts.map((draft) => draft.date),
  });

  const ranked = processAndRankStories(pool);
  const publishedUrlKeys = await getPublishedUrlKeys(date, ranked);
  for (const story of heldStories) {
    const key = storyUrlKey(story.url);
    if (key) publishedUrlKeys.add(key);
  }
  const { kept: urlKept, sameUrlCount, publishedUrlCount } = removeUrlDuplicates(
    ranked,
    publishedUrlKeys
  );
  const { heads: rankedCandidates, ...repeats } = await applyBoardRepeats({
    date: toDateOnlyIso(date),
    candidates: urlKept,
    held: heldStories,
  });

  logServerInfo("approval.outline.rank.result", {
    rankedCount: rankedCandidates.length,
    sameUrlCount,
    publishedUrlCount,
    repeatCount: repeats.removed.length,
  });

  // Taken before holds and duplicate checks, so stories the board does not show never look new.
  const candidateMarker = highestStoryId(candidateStories);

  return {
    referencedStories,
    rankedCandidates,
    unsentDrafts,
    candidateMarker,
    repeats,
  };
}

/**
 * Creates the approval board for a date: candidates ranked, with URL copies and
 * repeats removed and duplicates merged, then slotted into sections.
 */
export async function createOutlineCandidateStories(
  date: Date,
  options: OutlineOptions = {}
): Promise<{
  outline: ApprovalOutlineData;
  referencedStories: StoryRecord[];
  rankedCandidates: ProcessedStory[];
}> {
  const { referencedStories, rankedCandidates, unsentDrafts, candidateMarker, repeats } =
    await loadRankedCandidates(date, options);

  return {
    outline: buildApprovalOutline(rankedCandidates, referencedStories, { unsentDrafts, candidateMarker, repeats }),
    referencedStories,
    rankedCandidates,
  };
}

/** The approval board for a date. Used by `/api/newsletters/outline`. */
export async function createApprovalOutlineData(
  date: Date
): Promise<ApprovalOutlineData> {
  const { outline } = await createOutlineCandidateStories(date);
  return outline;
}
