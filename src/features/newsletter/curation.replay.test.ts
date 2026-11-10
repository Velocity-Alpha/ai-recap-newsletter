import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));
vi.mock("@/src/server/observability", () => ({
  logServerInfo: vi.fn(),
  logServerError: vi.fn(),
}));

import archive from "@/src/features/newsletter/__fixtures__/archived-boards.json";
import {
  buildApprovalOutline,
  normalizeCategory,
  type ApprovalOutlineData,
  type ProcessedStory,
} from "@/src/features/newsletter/curation.service";

type ArchivedBoard = (typeof archive.boards)[number];

// Which ranked pool each section draws from.
const SECTION_POOL: Record<string, string> = {
  headlines: "general",
  quickHits: "general",
  research: "research",
  tools: "tools",
};

/** Turns fixture entries into ranked stories; array order is the rank. */
function toRankedStories(pool: ArchivedBoard["ranked_pool"]): ProcessedStory[] {
  return pool.map((entry, index) => ({
    id: entry.id,
    guid: null,
    day: null,
    headline: entry.headline,
    summary: "",
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
}

function shownIds(outline: ApprovalOutlineData): number[] {
  return outline.candidate_sections.flatMap((section) =>
    [...section.selected, ...section.fill_ins].map((story) => story.id)
  );
}

/** The board with refill: rejects dropped first, then slots filled from what is left. */
function boardWithRefill(board: ArchivedBoard): ApprovalOutlineData {
  const removed = new Set(board.removed_ids);
  const kept = toRankedStories(board.ranked_pool).filter((story) => !removed.has(story.id));
  return buildApprovalOutline(kept, []);
}

describe("approval board replay of the archived commits (doc 80)", () => {
  it.each(archive.boards.map((board) => [board.date, board] as const))(
    "%s: never shows a story the duplicate check removed",
    (_date, board) => {
      const shown = shownIds(boardWithRefill(board));
      for (const id of board.removed_ids) expect(shown).not.toContain(id);
    }
  );

  it.each(archive.boards.map((board) => [board.date, board] as const))(
    "%s: leaves no slot empty while a kept story of its kind is unused",
    (_date, board) => {
      const outline = boardWithRefill(board);
      const shown = new Set(shownIds(outline));
      const removed = new Set(board.removed_ids);
      const unused = board.ranked_pool.filter(
        (entry) => !removed.has(entry.id) && !shown.has(entry.id)
      );

      for (const section of outline.candidate_sections) {
        if (section.selected.length >= section.max) continue;
        const pool = SECTION_POOL[section.key];
        const unusedOfKind = unused.filter((entry) => normalizeCategory(entry.category) === pool);
        expect(unusedOfKind, `${section.key} has empty slots`).toEqual([]);
      }
    }
  );

  it("pre-selects at least as many stories as the archived boards did, and as many as were approved", () => {
    const rows = archive.boards.map((board) => ({
      date: board.date,
      before: board.default_selected,
      after: boardWithRefill(board).selected_story_ids.length,
      approved: board.approved_count,
    }));

    for (const row of rows) {
      expect(row.after, row.date).toBeGreaterThanOrEqual(row.before);
    }

    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    // Doc 80: the archived boards pre-selected a median 10 stories against 12.5 approved.
    expect(median(rows.map((row) => row.before))).toBe(10);
    expect(median(rows.map((row) => row.after))).toBeGreaterThanOrEqual(
      median(rows.map((row) => row.approved))
    );
  });

  it("proposes the reviewer's lead more often than the old default #1 Top Story did", () => {
    const rows = archive.boards.map((board) => {
      const outline = boardWithRefill(board);
      // The old default lead: the first Top Story, i.e. the top-ranked kept story of the general pool.
      const removed = new Set(board.removed_ids);
      const firstGeneral = board.ranked_pool.find(
        (entry) => !removed.has(entry.id) && normalizeCategory(entry.category) === "general"
      );
      return {
        date: board.date,
        chosen: board.lead_id,
        oldDefault: firstGeneral?.id ?? null,
        proposed: outline.proposed_lead_id,
        selected: outline.selected_story_ids,
      };
    });
    const oldHits = rows.filter((row) => row.oldDefault === row.chosen).length;
    const proposedHits = rows.filter((row) => row.proposed === row.chosen).length;
    console.info(
      `Lead replay: proposed = chosen in ${proposedHits} of ${rows.length} commits` +
        ` (old default #1 Top Story: ${oldHits} of ${rows.length}).\n` +
        rows.map((row) => `  ${row.date} chosen ${row.chosen}, proposed ${row.proposed}`).join("\n")
    );

    // Doc 80: the default #1 Top Story became the lead in 2 of 10 commits.
    expect(oldHits).toBe(2);
    expect(proposedHits).toBeGreaterThan(oldHits);
    // The proposal is always pre-selected, so the board's commit check accepts it as is.
    for (const row of rows) expect(row.selected, row.date).toContain(row.proposed);
  });
});
