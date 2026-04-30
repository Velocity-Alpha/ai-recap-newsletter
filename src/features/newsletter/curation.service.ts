import { OpenRouter } from "@openrouter/sdk";
import type { ChatMessages, ChatRequest } from "@openrouter/sdk/models";
import { Prisma } from "@/src/generated/prisma";
import { prisma } from "@/src/server/prisma";
import { logServerError, logServerWarn } from "@/src/server/observability";

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
  day: string | null;
  headline: string;
  summary: string;
}

interface DraftApprovalData {
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
};

// Configuration
const SECTION_LIMITS = {
  headlines: 3,
  research: 4,
  tools: 3,
  quickHits: 6,
};
const FILL_IN_LIMIT = 3;
const OPENROUTER_DEDUP_MODELS = [
  "deepseek/deepseek-v4-flash",
  "google/gemini-3-flash-preview",
];
const DEFAULT_AI_DEDUP_TIMEOUT_MS = 60_000;
export const OPENROUTER_RESPONSE_CACHE_TTL_SECONDS = 86_400;
const DEDUPLICATION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    kept_story_ids: {
      type: "array",
      description:
        "IDs from incoming_stories that should remain after removing semantic duplicates.",
      items: {
        type: "integer",
      },
    },
  },
  required: ["kept_story_ids"],
  additionalProperties: false,
};

type OpenRouterRequestOptions = Parameters<OpenRouter["chat"]["send"]>[1];

function getAiDedupTimeoutMs(): number {
  const configured = Number(process.env.OPENROUTER_DEDUP_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_AI_DEDUP_TIMEOUT_MS;
}

/**
 * Defines the structured output contract OpenRouter should enforce.
 *
 * OpenRouter's SDK uses camelCase for `responseFormat` / `jsonSchema` and
 * serializes those fields to the API's `response_format` / `json_schema`
 * shape. `strict` plus `additionalProperties: false` keeps the response small
 * and predictable.
 */
export function buildDeduplicationResponseFormat(): ChatRequest["responseFormat"] {
  return {
    type: "json_schema",
    jsonSchema: {
      name: "newsletter_deduplication_result",
      strict: true,
      schema: DEDUPLICATION_RESPONSE_SCHEMA,
    },
  };
}

/**
 * Builds the OpenRouter chat request used for AI duplicate detection.
 *
 * The request intentionally uses a model fallback list instead of a single
 * model so DeepSeek V4 Flash is tried first and Gemini Flash is used if
 * DeepSeek cannot serve the request. Provider routing is price-sorted,
 * restricted to providers that support every requested parameter, and excludes
 * providers that collect data.
 * The response is constrained with OpenRouter structured outputs so parsing is
 * based on a stable JSON Schema instead of prompt-only JSON instructions.
 */
export function buildOpenRouterDeduplicationRequest(
  messages: ChatRequest["messages"]
) {
  return {
    chatRequest: {
      models: OPENROUTER_DEDUP_MODELS,
      messages,
      provider: {
        allowFallbacks: true,
        dataCollection: "deny",
        requireParameters: true,
        sort: "price",
      },
      responseFormat: buildDeduplicationResponseFormat(),
      stream: false,
    } satisfies ChatRequest,
  };
}

/**
 * Keeps the approval page responsive even when an upstream model or provider
 * stalls. The curation flow can safely continue without AI deduplication, so
 * this path should fail fast instead of retrying for a long time.
 *
 * This deliberately avoids the SDK's `timeoutMs` option. In Node/Next, that
 * option currently uses `AbortSignal.timeout()`, which can throw a DOMException
 * with a read-only `message` property and crash while the SDK wraps the error.
 */
export function buildOpenRouterDeduplicationRequestOptions(
  timeoutMs = getAiDedupTimeoutMs()
): OpenRouterRequestOptions {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new Error(`OpenRouter deduplication timed out after ${timeoutMs}ms`)
    );
  }, timeoutMs);

  timeout.unref?.();

  return {
    headers: {
      "X-OpenRouter-Cache": "true",
      "X-OpenRouter-Cache-TTL": String(OPENROUTER_RESPONSE_CACHE_TTL_SECONDS),
    },
    signal: controller.signal,
    retries: { strategy: "none" },
  };
}

/**
 * Enforces a wall-clock timeout around the full OpenRouter operation.
 *
 * OpenRouter can send headers or whitespace keepalive bytes before the model
 * finishes. In that case an HTTP abort/SDK timeout may no longer bound the full
 * `chat.send()` promise, so the approval page needs this outer timer too.
 */
export function runWithOpenRouterDeduplicationTimeout<T>(
  operation: Promise<T>,
  timeoutMs = getAiDedupTimeoutMs()
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`OpenRouter deduplication timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref?.();
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

/**
 * Parses and validates the structured deduplication response.
 *
 * The schema should prevent malformed payloads, but this keeps the service
 * defensive against provider bugs, model fallback quirks, or hand-crafted test
 * payloads. It also filters out IDs that do not belong to this candidate set.
 */
export function parseDeduplicationKeptStoryIds(
  textContent: string,
  validStoryIds: Set<number>
): number[] | null {
  const parsed = JSON.parse(textContent.trim()) as { kept_story_ids?: unknown };
  if (!Array.isArray(parsed.kept_story_ids)) {
    return null;
  }

  const keptIds = new Set<number>();
  for (const id of parsed.kept_story_ids) {
    const numericId = Number(id);
    if (Number.isInteger(numericId) && validStoryIds.has(numericId)) {
      keptIds.add(numericId);
    }
  }

  return Array.from(keptIds);
}

// Patterns to remove from text
const REMOVAL_PATTERNS = [
  /sponsored by[^.!?]*[.!?]/gi,
  /together with[^.!?]*[.!?]/gi,
  /presented by[^.!?]*[.!?]/gi,
  /partner content[^.!?]*[.!?]/gi,
  /paid partnership[^.!?]*[.!?]/gi,
  /in partnership with[^.!?]*[.!?]/gi,
  /brought to you by[^.!?]*[.!?]/gi,
  /tldr[^.!?]*[.!?]/gi,
  /ai breakfast[^.!?]*[.!?]/gi,
  /rundown(?: ai)?[^.!?]*[.!?]/gi,
  /source:\s*[^.!?\\n]+(?:[.!?]|$)/gi,
  /via\s*[^.!?\\n]+(?:[.!?]|$)/gi,
  /as reported by[^.!?\\n]+[.!?]/gi,
  /learn more\s*(?:on|at|via|about)?\s*[^.!?\\n]*[.!?]?/gi,
  /read more\s*(?:on|at|via|about)?\s*[^.!?\\n]*[.!?]?/gi,
  /check it out\s*(?:on|at|via)?\s*[^.!?\\n]*[.!?]?/gi,
  /visit\s*(?:our)?\s*(?:website|site)\s*[^.!?\\n]*[.!?]?/gi,
  /for more information\s*[^.!?\\n]*[.!?]?/gi,
  /https?:\/\/[^\s]+/g,
  /www\.[^\s]+/g,
  /\[([^\]]+)\]\(([^)]+)\)/g,
  /`/g,
  /\*\*/g,
  /\*/g,
  /#+\s*/g,
  /^\s*[-•*]\s+/gm,
  /\n\s*[-•*]\s+/g,
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
function cleanText(value: string | null | undefined): string {
  if (!value) return "";

  let cleaned = String(value);

  for (const pattern of REMOVAL_PATTERNS) {
    cleaned = cleaned.replace(pattern, "$1");
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
  const raw = story.day;
  const dayStr =
    raw instanceof Date
      ? raw.toISOString().slice(0, 10)
      : typeof raw === "string"
        ? raw.slice(0, 10)
        : null;
  return {
    id: story.id,
    day: dayStr,
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
  };
}

/**
 * Formats dates as YYYY-MM-DD for date-window SQL filters.
 */
function toDateOnlyIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Loads recently used stories for the requested publication date.
 *
 * These are not candidates. They are reference material for semantic
 * deduplication so the draft does not repeat stories that appeared in the
 * last few issues.
 */
async function getReferencedStories(date: Date): Promise<StoryRecord[]> {
  const dateOnly = toDateOnlyIso(date);
  console.log("[approval:draft] fetch.referenced.query", {
    requestedDateIso: date.toISOString(),
    dateOnly,
  });

  const rows = await prisma.$queryRaw<RawStoryRow[]>(Prisma.sql`
    SELECT DISTINCT ON (guid)
      id,
      guid,
      day,
      headline,
      url,
      summary,
      category,
      source,
      story_details,
      importance_score
    FROM newsletter.stories
    WHERE used_in_publication_date <= ${dateOnly}::date
      AND exclude_from_candidates IS FALSE
      AND used_in_publication_date >= ${dateOnly}::date - INTERVAL '2 days'
  `);

  console.log("[approval:draft] fetch.referenced.rows", {
    rowCount: rows.length,
    sample: rows.slice(0, 10).map((row) => ({
      id: row.id,
      guid: row.guid,
      day: row.day,
      headline: row.headline,
      usedWindowDate: dateOnly,
      importance_score: row.importance_score,
    })),
  });

  return rows.map(toStoryRecord);
}

/**
 * Loads eligible unpublished candidate stories for the approval draft.
 *
 * The SQL filter keeps the candidate pool recent, sufficiently important,
 * usable as a source link, and not already consumed by a publication.
 */
async function getCandidateStories(date: Date): Promise<StoryRecord[]> {
  const dateOnly = toDateOnlyIso(date);
  console.log("[approval:draft] fetch.candidates.query", {
    requestedDateIso: date.toISOString(),
    dateOnly,
  });

  const rows = await prisma.$queryRaw<RawStoryRow[]>(Prisma.sql`
    SELECT DISTINCT ON (guid)
      id,
      guid,
      day,
      headline,
      url,
      summary,
      category,
      source,
      story_details,
      importance_score
    FROM newsletter.stories
    WHERE importance_score >= 2
      AND day IS NOT NULL
      AND day <= ${dateOnly}::date
      AND day >= (${dateOnly}::date - INTERVAL '3 days')
      AND url NOT ILIKE '%tldr%'
      AND url NOT ILIKE '%rundown%'
      AND url NOT ILIKE '%beehive%'
      AND url IS NOT NULL
      AND url != ''
      AND used_in_publication_date IS NULL
      AND exclude_from_candidates IS FALSE
  `);

  console.log("[approval:draft] fetch.candidates.rows", {
    rowCount: rows.length,
    sample: rows.slice(0, 12).map((row) => ({
      id: row.id,
      guid: row.guid,
      day: row.day,
      headline: row.headline,
      url: row.url,
      category: row.category,
      importance_score: row.importance_score,
    })),
  });

  return rows.map(toStoryRecord);
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
 * Identifies transient network failures where AI deduplication should be
 * skipped without blocking the rest of draft creation.
 */
function isAiConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const nestedCause = error.cause as { code?: string } | undefined;
  const code = nestedCause?.code;

  return (
    error.name === "RequestTimeoutError" ||
    error.name === "RequestAbortedError" ||
    error.name === "ConnectionError" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    error.message.toLowerCase().includes("connection error") ||
    error.message.toLowerCase().includes("timed out")
  );
}

/**
 * Uses OpenRouter to remove semantic duplicates from the ranked candidate list.
 *
 * The model compares candidates against recently used stories and against each
 * other, then returns the IDs that should remain. If OpenRouter is unavailable,
 * returns every incoming ID so draft generation can continue deterministically.
 */
async function deduplicateWithAI(
  incomingStories: ProcessedStory[],
  referencedStories: StoryRecord[]
): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logServerWarn(
      "OPENROUTER_API_KEY not configured, skipping AI deduplication"
    );
    return incomingStories.map((s) => s.id);
  }

  const client = new OpenRouter({
    apiKey,
    httpReferer: process.env.NEXT_PUBLIC_SITE_URL || "https://airecap.news",
    appTitle: "AI Recap",
  });

  const incomingPayload = incomingStories.map((s) => ({
    id: s.id,
    headline: s.headline,
    summary: s.summary,
    story_details: s.story_details,
  }));

  const referencedPayload = referencedStories.map((s) => ({
    id: s.id,
    headline: cleanText(s.headline),
    summary: cleanText(s.summary),
    story_details: cleanText(s.story_details),
  }));

  console.log("[approval:draft] dedup.start", {
    incomingCount: incomingPayload.length,
    referencedCount: referencedPayload.length,
    incomingIds: incomingPayload.slice(0, 12).map((story) => story.id),
  });

  console.log("[approval:draft] dedup.provider", {
    provider: "openrouter",
    models: OPENROUTER_DEDUP_MODELS,
    hasApiKey: Boolean(apiKey),
    timeoutMs: getAiDedupTimeoutMs(),
  });

  try {
    const messages: ChatMessages[] = [
      {
        role: "system",
        content:
          "You identify duplicate news stories by comparing the underlying event being reported. Return only valid JSON.",
      },
      {
        role: "user",
        content: `You will receive a JSON object with:

* \`incoming_stories\`: an array of incoming story objects that have not been used before.
* \`previously_used_stories\`: an array of story objects that have already been used.

Your task is to decide which incoming stories should be kept, then return only their IDs.

Core rule:
* Remove any incoming story that is meaningfully the same underlying story as something in \`previously_used_stories\`.
* If multiple incoming stories are meaningfully the same underlying story as each other, keep only the strongest one and remove the rest.

Important judgment guidance:
* Two stories can describe the same underlying event even if their headlines, summaries, phrasing, IDs, and URLs are different.
* Focus on the underlying news item being reported: the event, announcement, launch, release, acquisition, update, ruling, funding round, product change, or other concrete development.
* If two stories clearly point to the same underlying development, treat them as duplicates.
* Do not merge stories just because they mention the same company, product, person, or topic area. If they describe different developments, keep them separate.

Your tasks:
1. Compare each incoming story against \`previously_used_stories\`.
   - If an incoming story is semantically the same underlying story as a previously used story, remove it.

2. Compare stories within \`incoming_stories\`.
   - If multiple incoming stories are semantically the same underlying story, keep only one.

3. When choosing which duplicate to keep, keep the one with the more complete, specific, and information-rich \`summary\` or \`story_details\`.

Output exactly one JSON object:
{
  "kept_story_ids": [123, 456, 789]
}

Rules:
* Include only IDs from \`incoming_stories\`
* Do not include IDs from \`previously_used_stories\`
* Do not include duplicates
* Preserve the original ID values exactly as provided

INPUT:
${JSON.stringify({
  incoming_stories: incomingPayload,
  previously_used_stories: referencedPayload,
})}`,
      },
    ];

    const response = await runWithOpenRouterDeduplicationTimeout(
      client.chat.send(
        buildOpenRouterDeduplicationRequest(messages),
        buildOpenRouterDeduplicationRequestOptions()
      )
    );

    console.log("[approval:draft] dedup.openrouter_response", {
      responseModel: response.model,
      promptTokens: response.usage?.promptTokens ?? null,
      completionTokens: response.usage?.completionTokens ?? null,
      totalTokens: response.usage?.totalTokens ?? null,
    });

    const textContent = response.choices[0]?.message?.content;
    if (!textContent) {
      logServerError("newsletter.ai_dedup.empty_response", new Error("OpenRouter returned no content"));
      return incomingStories.map((s) => s.id);
    }

    console.log("[approval:draft] dedup.raw_response", textContent);

    const validIds = new Set(incomingStories.map((story) => story.id));
    const keptIds = parseDeduplicationKeptStoryIds(textContent, validIds);
    if (!keptIds) {
      logServerError(
        "newsletter.ai_dedup.invalid_payload",
        new Error("OpenRouter response did not contain kept_story_ids array"),
      );
      return incomingStories.map((s) => s.id);
    }

    console.log("[approval:draft] dedup.result", {
      keptCount: keptIds.length,
      keptIds,
    });

    return keptIds;
  } catch (error) {
    if (isAiConnectionError(error)) {
      logServerWarn("newsletter.ai_dedup.skipped_connection_error", {
        message: error instanceof Error ? error.message : "Unknown connection error",
      });
      return incomingStories.map((s) => s.id);
    }

    logServerError("newsletter.ai_dedup.failed", error);
    return incomingStories.map((s) => s.id);
  }
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
function createSectionBlueprints(
  research: ProcessedStory[],
  tools: ProcessedStory[],
  general: ProcessedStory[]
): CandidateSection[] {
  const blueprints = [
    {
      key: "headlines",
      label: "Top Stories",
      max: SECTION_LIMITS.headlines,
      selected: general.slice(0, SECTION_LIMITS.headlines),
      fill_ins: general.slice(
        SECTION_LIMITS.headlines,
        SECTION_LIMITS.headlines + FILL_IN_LIMIT
      ),
    },
    {
      key: "research",
      label: "Research & Analysis",
      max: SECTION_LIMITS.research,
      selected: research.slice(0, SECTION_LIMITS.research),
      fill_ins: research.slice(
        SECTION_LIMITS.research,
        SECTION_LIMITS.research + FILL_IN_LIMIT
      ),
    },
    {
      key: "tools",
      label: "Tools",
      max: SECTION_LIMITS.tools,
      selected: tools.slice(0, SECTION_LIMITS.tools),
      fill_ins: tools.slice(
        SECTION_LIMITS.tools,
        SECTION_LIMITS.tools + FILL_IN_LIMIT
      ),
    },
    {
      key: "quickHits",
      label: "Quick Hits",
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
    }))
    .filter((section) => section.selected.length || section.fill_ins.length);
}

/**
 * Creates all data needed to render the newsletter draft approval screen.
 *
 * Pipeline:
 * 1. Load recently published reference stories and unpublished candidates.
 * 2. Clean and rank candidates.
 * 3. Remove semantic duplicates with AI when configured.
 * 4. Group survivors into editorial sections and fill-in pools.
 * 5. Return section data, a full story lookup map, and initially selected IDs.
 */
export async function createDraftApprovalData(
  date: Date
): Promise<DraftApprovalData> {
  console.log("[approval:draft] create.start", {
    date: date.toISOString(),
  });

  // Fetch stories
  const [referencedStories, candidateStories] = await Promise.all([
    getReferencedStories(date),
    getCandidateStories(date),
  ]);

  console.log("[approval:draft] fetch.result", {
    referencedCount: referencedStories.length,
    candidateCount: candidateStories.length,
    referencedIds: referencedStories.slice(0, 10).map((story) => story.id),
    candidateIds: candidateStories.slice(0, 15).map((story) => story.id),
  });

  // Process and rank candidates
  const rankedCandidates = processAndRankStories(candidateStories);

  console.log("[approval:draft] rank.result", {
    rankedCount: rankedCandidates.length,
    topRankedIds: rankedCandidates.slice(0, 15).map((story) => ({
      id: story.id,
      combined_score: story.combined_score,
      category: story.category,
    })),
  });

  // AI deduplication
  const keptStoryIds = await deduplicateWithAI(rankedCandidates, referencedStories);

  // Filter to kept stories
  const dedupedStories = rankedCandidates.filter((s) =>
    keptStoryIds.includes(s.id)
  );

  console.log("[approval:draft] dedup.filtered", {
    keptCount: keptStoryIds.length,
    dedupedCount: dedupedStories.length,
    dedupedIds: dedupedStories.slice(0, 15).map((story) => story.id),
  });

  // Group by category
  const grouped = groupStoriesByCategory(dedupedStories);

  console.log("[approval:draft] grouped", {
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

  for (const section of candidate_sections) {
    for (const story of section.selected) {
      const fullStory = dedupedStories.find((s) => s.id === story.id);
      if (fullStory) {
        candidate_map[String(story.id)] = fullStory;
        selected_story_ids.add(story.id);
      }
    }

    for (const story of section.fill_ins) {
      const fullStory = dedupedStories.find((s) => s.id === story.id);
      if (fullStory) {
        candidate_map[String(story.id)] = fullStory;
      }
    }
  }

  console.log("[approval:draft] final", {
    sectionCount: candidate_sections.length,
    sections: candidate_sections.map((section) => ({
      key: section.key,
      selectedCount: section.selected.length,
      fillInCount: section.fill_ins.length,
      selectedIds: section.selected.map((story) => story.id),
      fillInIds: section.fill_ins.map((story) => story.id),
    })),
    selectedStoryIds: Array.from(selected_story_ids),
  });

  return {
    reference_stories: referencedStories.map(toReferenceStory),
    candidate_sections,
    candidate_map,
    selected_story_ids: Array.from(selected_story_ids),
  };
}
