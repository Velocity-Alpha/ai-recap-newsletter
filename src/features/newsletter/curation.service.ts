import { prisma } from "@/src/server/prisma";
import { logServerError, logServerInfo } from "@/src/server/observability";
import { CANDIDATE_SECTION_CONFIGS, type SectionKey } from "@/src/features/newsletter/section-config";

interface StoryRecord {
  id: number;
  guid: string | null;
  day: Date | string | null;
  headline: string | null;
  summary: string | null;
  story_details: string | null;
  category: string | null;
  source: string | null;
  url: string | null;
  importance_score: number | null;
  paywall_detected?: "yes" | "no" | "unknown" | "error";
  error?: string | null;
  used_in_publication_date?: Date | string | null;
}

interface ProcessedStory extends StoryRecord {
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
  paywall_detected: "yes" | "no" | "unknown" | "error";
  error?: string | null;
  headline: string;
  summary: string;
}

interface ApprovalOutlineData {
  reference_stories: ReferenceStory[];
  candidate_sections: CandidateSection[];
  candidate_map: Record<
    string,
    StoryRecord & { keyword_score: number; combined_score: number }
  >;
  selected_story_ids: number[];
}

type RawStoryRow = {
  id: number;
  guid: string | null;
  day: Date | string | null;
  headline: string | null;
  url: string | null;
  summary: string | null;
  category: string | null;
  source: string | null;
  story_details: string | null;
  importance_score: number | null;
  paywall_detected: string | null;
};

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
 * newsletter-specific boilerplate. Cleaning here keeps ranking and AI
 * deduplication focused on the actual story content.
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
function normalizeCategory(category: string | null | undefined): string {
  const normalized = String(category ?? "").toLowerCase().trim();
  if (normalized === "research" || normalized === "analysis") return "research";
  if (normalized === "tools" || normalized === "tool") return "tools";
  return "general";
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
 * the approval screen and supplied to AI deduplication.
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
    paywall_detected: normalizePaywallDetected(story.paywall_detected),
    error: story.error,
    headline: cleanText(story.headline) || "Untitled story",
    summary: cleanText(story.summary),
  };
}

/**
 * Normalizes raw Prisma SQL rows into the service's internal story type.
 */
function toStoryRecord(row: RawStoryRow): StoryRecord {
  return {
    id: Number(row.id),
    guid: row.guid,
    day: row.day,
    headline: row.headline,
    summary: row.summary,
    story_details: row.story_details,
    category: row.category,
    source: row.source,
    url: row.url,
    importance_score: row.importance_score,
    paywall_detected: normalizePaywallDetected(row.paywall_detected),
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
 * These are not candidates. They are reference material for semantic
 * deduplication so the outline does not repeat stories that appeared in the
 * last few issues.
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
 * Loads eligible unpublished candidate stories for the approval outline.
 *
 * The SQL filter keeps the candidate pool recent, sufficiently important,
 * usable as a source link, and not already consumed by a publication.
 */
async function getCandidateStories(date: Date): Promise<StoryRecord[]> {
  const dateOnly = toDateOnlyIso(date);
  const targetDate = toUtcDateFromDateOnly(dateOnly);
  const candidateWindowStartDate = new Date(targetDate);
  candidateWindowStartDate.setUTCDate(candidateWindowStartDate.getUTCDate() - 3);

  logServerInfo("approval.outline.fetch.candidates.query", {
    requestedDateIso: date.toISOString(),
    dateOnly,
  });

  const candidateStories = await prisma.story.findMany({
    where: {
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
          { url: { contains: "tldr", mode: "insensitive" } },
          { url: { contains: "rundown", mode: "insensitive" } },
          { url: { contains: "beehiiv", mode: "insensitive" } },
        ],
      },
    },
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

  return candidateStoryRecords;
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
      fill_ins: general.slice(
        SECTION_LIMITS.headlines,
        SECTION_LIMITS.headlines + FILL_IN_LIMIT
      ),
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
      selected: general.slice(
        SECTION_LIMITS.headlines + FILL_IN_LIMIT,
        SECTION_LIMITS.headlines + FILL_IN_LIMIT + SECTION_LIMITS.quickHits
      ),
      fill_ins: general.slice(
        SECTION_LIMITS.headlines + FILL_IN_LIMIT + SECTION_LIMITS.quickHits,
        SECTION_LIMITS.headlines +
          FILL_IN_LIMIT +
          SECTION_LIMITS.quickHits +
          FILL_IN_LIMIT
      ),
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
 * Creates all data needed to render the newsletter outline approval screen,
 * WITHOUT AI deduplication. Used for fast initial load with pending status.
 *
 * Pipeline:
 * 1. Load recently published reference stories and unpublished candidates.
 * 2. Clean and rank candidates.
 * 3. Skip AI deduplication (happens async via OpenAI Responses API background job; caller receives a response_id to poll).
 * 4. Group stories into editorial sections and fill-in pools.
 * 5. Return section data, a full story lookup map, and initially selected IDs.
 */
export async function createOutlineCandidateStories(
  date: Date
): Promise<{
  outline: ApprovalOutlineData;
  referencedStories: StoryRecord[];
  rankedCandidates: ProcessedStory[];
}> {
  logServerInfo("approval.outline.create.start", { date: date.toISOString() });

  // Fetch stories
  const [referencedStories, candidateStories] = await Promise.all([
    getReferencedStories(date),
    getCandidateStories(date),
  ]);

  logServerInfo("approval.outline.fetch.result", {
    referencedCount: referencedStories.length,
    candidateCount: candidateStories.length,
  });

  // Process and rank candidates
  const rankedCandidates = processAndRankStories(candidateStories);

  logServerInfo("approval.outline.rank.result", { rankedCount: rankedCandidates.length });

  // Skip AI deduplication — use all ranked stories
  const dedupedStories = rankedCandidates;

  logServerInfo("approval.outline.dedup.skipped", {
    storyCount: dedupedStories.length,
  });

  // Group by category
  const grouped = groupStoriesByCategory(dedupedStories);

  logServerInfo("approval.outline.grouped", {
    researchCount: grouped.research.length,
    toolsCount: grouped.tools.length,
    generalCount: grouped.general.length,
  });

  // Create section blueprints
  const candidate_sections = createSectionBlueprints(
    grouped.research,
    grouped.tools,
    grouped.general
  );

  // Build candidate map and selected IDs
  const candidate_map: Record<string, ProcessedStory> = {};
  const selected_story_ids = new Set<number>();
  const dedupedStoryMap = new Map<number, ProcessedStory>(
    dedupedStories.map((story) => [story.id, story])
  );

  for (const section of candidate_sections) {
    for (const story of section.selected) {
      const fullStory = dedupedStoryMap.get(story.id);
      if (fullStory) {
        candidate_map[String(story.id)] = fullStory;
        selected_story_ids.add(story.id);
      }
    }

    for (const story of section.fill_ins) {
      const fullStory = dedupedStoryMap.get(story.id);
      if (fullStory) {
        candidate_map[String(story.id)] = fullStory;
      }
    }
  }

  const outline: ApprovalOutlineData = {
    reference_stories: referencedStories.map(toReferenceStory),
    candidate_sections,
    candidate_map,
    selected_story_ids: Array.from(selected_story_ids),
  };

  logServerInfo("approval.outline.final", {
    sectionCount: candidate_sections.length,
    selectedStoryCount: selected_story_ids.size,
  });

  return {
    outline,
    referencedStories,
    rankedCandidates,
  };
}

/**
 * Legacy function — kept for backwards compatibility.
 * Now calls createOutlineCandidateStories (skips blocking AI dedup).
 */
export async function createApprovalOutlineData(
  date: Date
): Promise<ApprovalOutlineData> {
  const { outline } = await createOutlineCandidateStories(date);
  return outline;
}
