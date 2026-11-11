import { join } from "node:path";

import type { ArchivedBoard } from "@/evals/lead-pick/boards";
import {
  buildApprovalOutline,
  processAndRankStories,
  type ProcessedStory,
  type StoryRecord,
} from "@/src/features/newsletter/curation.service";
import { storySources } from "@/src/features/newsletter/lead-story";
import { storyUrlKey } from "@/src/features/newsletter/story-url";

/**
 * A board of a native approval commit (newsletter.approval_outlines), in the format of the archived boards
 * (src/features/newsletter/__fixtures__/archived-boards.json), so the lead pick eval reads both alike. The pool is
 * rebuilt as of the commit time with the board's rules (doc 80, A.5), ranked by the board's own ranking.
 */

/** The native boards, written by build-native-boards.ts and committed. */
export const NATIVE_BOARDS_PATH = join("evals", "lead-pick", "native-boards.json");

const inline = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(inline).join(", ")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${inline(entry)}`).join(", ")}}`
      : JSON.stringify(value);

/** The fixture's text in its own layout: one pool story per line, short arrays on one line. */
export function archiveJson(file: { note: string; boards: ArchivedBoard[] }): string {
  const boards = file.boards.map((board) => {
    const { ranked_pool: pool, ...fields } = board;
    const lines = Object.entries(fields).map(([key, value]) => `      ${JSON.stringify(key)}: ${inline(value)},`);
    const stories = pool.map((story) => `        ${inline(story)}`).join(",\n");
    return `    {\n${lines.join("\n")}\n      "ranked_pool": [\n${stories}\n      ]\n    }`;
  });
  return `{\n  "note": ${JSON.stringify(file.note)},\n  "boards": [\n${boards.join(",\n")}\n  ]\n}\n`;
}

/** A native approval commit: its date, and the stories it approved per section and as the lead. */
export interface NativeCommit {
  date: string;
  leadStoryId: number;
  sections: Array<{ key: string; storyIds: number[] }>;
}

/**
 * The candidate stories as the board read them at commit time (the SQL of build-native-boards.ts), in the board's
 * read order (day, then id, newest first). `sources` is each row's own source: story_sources starts later.
 */
export type PoolRow = StoryRecord;

/**
 * Drops guid copies (first read wins, as the board does), ranks, then drops URL copies: a URL that ran in an
 * earlier issue, or a copy of a higher-ranked story, whose newsletter is credited to the story kept. These mirror
 * the board's private steps in curation.service.ts; the ranking itself is the board's.
 */
export function rankedPoolOf(rows: PoolRow[], publishedUrlKeys: ReadonlySet<string>): ProcessedStory[] {
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    const key = row.guid ?? String(row.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const kept: ProcessedStory[] = [];
  const keptByUrl = new Map<string, ProcessedStory>();
  for (const story of processAndRankStories(unique)) {
    const key = storyUrlKey(story.url);
    if (key && publishedUrlKeys.has(key)) continue;
    const original = key ? keptByUrl.get(key) : undefined;
    if (original) {
      original.sources = storySources({ source: original.source, sources: [...(original.sources ?? []), ...storySources(story)] });
      continue;
    }
    const copy = { ...story, sources: storySources(story) };
    if (key) keptByUrl.set(key, copy);
    kept.push(copy);
  }
  return kept;
}

/**
 * The archived-board entry of a native commit. Its duplicate check's removals were not stored, so `removed_ids` is
 * empty: the pool holds only stories not yet published (by row and by URL), and the lead pick's own repeat rule
 * covers the rest.
 */
export function nativeBoard(commit: NativeCommit, rows: PoolRow[], publishedUrlKeys: ReadonlySet<string>): ArchivedBoard {
  const ranked = rankedPoolOf(rows, publishedUrlKeys);
  if (!ranked.some((story) => story.id === commit.leadStoryId)) {
    throw new Error(`${commit.date}: the committed lead ${commit.leadStoryId} is not in the rebuilt pool.`);
  }
  return {
    date: commit.date,
    default_selected: buildApprovalOutline(ranked, []).selected_story_ids.length,
    approved_count: commit.sections.reduce((count, section) => count + section.storyIds.length, 0),
    removed_ids: [],
    lead_id: commit.leadStoryId,
    ranked_pool: ranked.map((story) => ({
      id: story.id,
      category: story.category ?? "",
      importance: story.importance_score ?? 0,
      sources: story.sources ?? [],
      headline: story.headline ?? "",
      paywall: story.paywall_detected ?? "unknown",
    })),
  };
}
