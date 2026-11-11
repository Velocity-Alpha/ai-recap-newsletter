import archive from "@/src/features/newsletter/__fixtures__/archived-boards.json";
import { buildApprovalOutline, type ProcessedStory } from "@/src/features/newsletter/curation.service";
import { LEAD_SHORTLIST_SIZE, leadShortlist, type LeadShortlistEntry } from "@/src/features/newsletter/lead-story";

/**
 * The 10 archived boards (src/features/newsletter/__fixtures__/archived-boards.json) as the lead pick sees them.
 * `curation.service` imports Prisma, so a test or eval that imports this file mocks `@/src/server/prisma`.
 */

export type ArchivedBoard = (typeof archive.boards)[number];

export interface LeadPickCase {
  date: string;
  /** The owner's committed lead: the ground truth. */
  ownerLeadId: number;
  /** The board's scored lead, before the AI pick: the score-only baseline. */
  scoredLeadId: number | null;
  shortlist: LeadShortlistEntry[];
  /** Earlier archived leads stand in for "recently published": they ran in the days before. */
  recentlyPublished: string[];
  outline: ReturnType<typeof buildApprovalOutline>;
}

export const ARCHIVED_BOARDS: ArchivedBoard[] = archive.boards;

export function headlineById(): Map<number, string> {
  return new Map(ARCHIVED_BOARDS.flatMap((board) => board.ranked_pool.map((entry) => [entry.id, entry.headline] as const)));
}

/** All story ids on the boards, to look up summaries. */
export function boardStoryIds(): number[] {
  return [...new Set(ARCHIVED_BOARDS.flatMap((board) => board.ranked_pool.map((entry) => entry.id)))];
}

function outlineFor(board: ArchivedBoard, summaryById: Map<number, string>) {
  const removed = new Set(board.removed_ids);
  const kept: ProcessedStory[] = board.ranked_pool
    .filter((entry) => !removed.has(entry.id))
    .map((entry, index, pool) => ({
      id: entry.id,
      guid: null,
      day: null,
      headline: entry.headline,
      summary: summaryById.get(entry.id) ?? "",
      story_details: "",
      category: entry.category,
      source: entry.sources[0] ?? null,
      sources: entry.sources,
      url: null,
      paywall_detected: entry.paywall as ProcessedStory["paywall_detected"],
      importance_score: entry.importance,
      keyword_score: 0,
      combined_score: pool.length - index,
    }));
  return buildApprovalOutline(kept, []);
}

/** One case per archived board, in date order. `summaryById` may be empty: the shortlist then has headlines only. */
export function leadPickCases(summaryById: Map<number, string>): LeadPickCase[] {
  const headlines = headlineById();
  return ARCHIVED_BOARDS.map((board, index) => {
    const outline = outlineFor(board, summaryById);
    return {
      date: board.date,
      ownerLeadId: board.lead_id,
      scoredLeadId: outline.proposed_lead_id ?? null,
      shortlist: leadShortlist(outline, LEAD_SHORTLIST_SIZE),
      recentlyPublished: ARCHIVED_BOARDS.slice(0, index).map((earlier) => headlines.get(earlier.lead_id) ?? ""),
      outline,
    };
  });
}
