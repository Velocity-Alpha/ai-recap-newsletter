import type { SectionKey } from "@/src/features/newsletter/section-config";
import type {
  PublishedBullet,
  PublishedFeatureStory,
  PublishedIssueContent,
  PublishedQuickHit,
  PublishedToolItem,
} from "@/src/pipeline/publish/sent-email-parser";

/**
 * The written issue: what the writer returns for one draft. It is n8n's `parsed_stories` shape
 * (docs/n8n-backend/20-drafting-and-images.md §1.6.3) with the owner's fixes: plain text in every field,
 * exactly 3 bullets per feature story, no `title_emoji`, a new `excerpt`, and numeric story ids (the
 * website's v2 parser and publish detection read `story_id` as a number).
 */

/** One approved story as the writer and the checks see it. */
export interface ApprovedStory {
  id: number;
  headline: string;
  summary: string;
  storyDetails: string | null;
  /** The link the issue uses: the board's link edit when there is one, else the story's own URL. */
  url: string;
  /** The owner's note from the board, or "" when there is none. */
  note: string;
}

/** Approved stories by board section, in board order. */
export type ApprovedSections = Record<SectionKey, ApprovedStory[]>;

/** Board section key -> key in the written content. */
export const CONTENT_SECTION_KEYS = {
  headlines: "headlines",
  research: "research_and_analysis",
  tools: "tools",
  quickHits: "quick_hits",
} as const satisfies Record<SectionKey, string>;

export type ContentSectionKey = (typeof CONTENT_SECTION_KEYS)[SectionKey];

/** Top Stories and Research & Analysis: each story gets a write-up with three bullets. */
export const FEATURE_SECTIONS = ["headlines", "research"] as const satisfies readonly SectionKey[];

export const FEATURE_BULLET_COUNT = 3;

export type HighlightBullet = PublishedBullet;
export type FeatureStory = PublishedFeatureStory;
export type ToolItem = PublishedToolItem;
export type QuickHit = PublishedQuickHit;

export interface WrittenIssueContent {
  title: string;
  excerpt: string;
  overview: { summary: string };
  headlines: FeatureStory[];
  research_and_analysis: FeatureStory[];
  tools: ToolItem[];
  quick_hits: QuickHit[];
}

const STORY_ID = { type: "integer", description: "The input story id, copied exactly." } as const;
const STORY_URL = { type: "string", description: "The input story url, copied exactly." } as const;

/** Strict JSON schema for the Responses API (`text.format`). */
export const WRITTEN_ISSUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "excerpt", "overview", "headlines", "research_and_analysis", "tools", "quick_hits"],
  properties: {
    title: {
      type: "string",
      description:
        "Concise 4-8 word subject line of the newsletter based on the lead story. Must be specific and be optimized for clickthrough and pique interest. Keep it curiosity driven and don't give away the punchline. Plain text, no emoji.",
    },
    excerpt: {
      type: "string",
      description: "One or two plain-text sentences that tease the issue's biggest news for the website and link previews.",
    },
    overview: { $ref: "#/$defs/overview_item" },
    headlines: {
      type: "array",
      description: "Main headline stories for the issue.",
      items: { $ref: "#/$defs/feature_item" },
    },
    research_and_analysis: {
      type: "array",
      description: "Deeper research, analysis, and context-rich stories.",
      items: { $ref: "#/$defs/feature_item" },
    },
    tools: {
      type: "array",
      description: "Tool launches, product updates, and useful links.",
      items: { $ref: "#/$defs/link_list_item" },
    },
    quick_hits: {
      type: "array",
      description: "Shorter stories and brief updates.",
      items: { $ref: "#/$defs/compact_list_item" },
    },
  },
  $defs: {
    overview_item: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: {
        summary: { type: "string", description: "A brief, conversational overview of 45 to 80 words." },
      },
    },
    feature_item: {
      type: "object",
      additionalProperties: false,
      required: ["story_id", "url", "headline", "story_detail", "bullets"],
      properties: {
        story_id: STORY_ID,
        url: STORY_URL,
        headline: { type: "string", description: "Clear, short, human-readable headline." },
        story_detail: {
          type: "string",
          description: "Two to four plain-text sentences with key details and context.",
        },
        bullets: {
          type: "array",
          minItems: FEATURE_BULLET_COUNT,
          maxItems: FEATURE_BULLET_COUNT,
          items: { $ref: "#/$defs/highlight_bullet" },
          description: "Exactly 3 highlighted takeaways that add facts not already in story_detail.",
        },
      },
    },
    link_list_item: {
      type: "object",
      additionalProperties: false,
      required: ["story_id", "url", "link_text", "detail"],
      properties: {
        story_id: STORY_ID,
        url: STORY_URL,
        link_text: { type: "string", description: "Short linked title text." },
        detail: { type: "string", description: "Brief supporting context for the link." },
      },
    },
    compact_list_item: {
      type: "object",
      additionalProperties: false,
      required: ["story_id", "url", "link_text", "text"],
      properties: {
        story_id: STORY_ID,
        url: STORY_URL,
        link_text: { type: "string", description: "Short linked title text." },
        text: { type: "string", description: "Compact summary text that continues the sentence after the link." },
      },
    },
    highlight_bullet: {
      type: "object",
      additionalProperties: false,
      required: ["before", "highlight", "after"],
      properties: {
        before: { type: "string", description: "Text before the highlighted phrase." },
        highlight: { type: "string", description: "Key phrase to emphasize." },
        after: { type: "string", description: "Text after the highlighted phrase." },
      },
    },
  },
} as const;

class ShapeError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string") throw new ShapeError(path ? `${path}.${key}` : key);
  return value;
}

function storyId(source: Record<string, unknown>, path: string): number {
  const value = source.story_id;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new ShapeError(`${path}.story_id`);
  return value;
}

function list<T>(source: Record<string, unknown>, key: string, read: (item: Record<string, unknown>, path: string) => T): T[] {
  const value = source[key];
  if (!Array.isArray(value)) throw new ShapeError(key);
  return value.map((item, index) => {
    const path = `${key}[${index}]`;
    if (!isRecord(item)) throw new ShapeError(path);
    return read(item, path);
  });
}

function readFeature(item: Record<string, unknown>, path: string): FeatureStory {
  const bullets = item.bullets;
  if (!Array.isArray(bullets)) throw new ShapeError(`${path}.bullets`);
  return {
    story_id: storyId(item, path),
    url: text(item, "url", path),
    headline: text(item, "headline", path),
    story_detail: text(item, "story_detail", path),
    bullets: bullets.map((bullet, index) => {
      const bulletPath = `${path}.bullets[${index}]`;
      if (!isRecord(bullet)) throw new ShapeError(bulletPath);
      return {
        before: text(bullet, "before", bulletPath),
        highlight: text(bullet, "highlight", bulletPath),
        after: text(bullet, "after", bulletPath),
      };
    }),
  };
}

/** Reads the model's JSON text into typed content, or throws naming the first field that is off. */
export function parseWrittenIssue(outputText: string): WrittenIssueContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("The writer's output is not valid JSON.");
  }

  try {
    if (!isRecord(parsed)) throw new ShapeError("root");
    const overview = parsed.overview;
    if (!isRecord(overview)) throw new ShapeError("overview");
    return {
      title: text(parsed, "title", ""),
      excerpt: text(parsed, "excerpt", ""),
      overview: { summary: text(overview, "summary", "overview") },
      headlines: list(parsed, "headlines", readFeature),
      research_and_analysis: list(parsed, "research_and_analysis", readFeature),
      tools: list(parsed, "tools", (item, path) => ({
        story_id: storyId(item, path),
        url: text(item, "url", path),
        link_text: text(item, "link_text", path),
        detail: text(item, "detail", path),
      })),
      quick_hits: list(parsed, "quick_hits", (item, path) => ({
        story_id: storyId(item, path),
        url: text(item, "url", path),
        link_text: text(item, "link_text", path),
        text: text(item, "text", path),
      })),
    };
  } catch (error) {
    if (error instanceof ShapeError) {
      throw new Error(`The writer's output does not match the schema (${error.message}).`);
    }
    throw error;
  }
}

/**
 * The issue's `content_json` (schema v2) for a draft: the keys, order, and types publish detection writes,
 * so the website renders it and a later publish only replaces it with the same data. Pass the image URL
 * the email shows (`emailImageUrl`) so the two match.
 */
export function toIssueContentJson(
  content: WrittenIssueContent,
  meta: { issueId: number; issueDate: string; featuredImageUrl: string }
): PublishedIssueContent {
  return {
    schemaVersion: 2,
    featured_image_url: meta.featuredImageUrl,
    title: content.title,
    date: meta.issueDate,
    issue_id: meta.issueId,
    overview: { summary: content.overview.summary },
    headlines: content.headlines,
    research_and_analysis: content.research_and_analysis,
    tools: content.tools,
    quick_hits: content.quick_hits,
  };
}
