import { STORY_SECTION_KEYS, type PublishedIssueContent, type StorySectionKey } from "@/src/pipeline/publish/sent-email-parser";

/**
 * The rows of `issue_stories` for one published issue (ADR 0007): which stories the sent email held, where, and
 * with which link. Pure: `publish` (publish-store.ts) writes them.
 */

export interface IssueStoryRow {
  storyId: number;
  section: StorySectionKey;
  /** Place in the section, from 1. */
  position: number;
  /** The link that was sent (`data-src-url`). */
  url: string | null;
  /** Null when the sent draft is not known. */
  isLead: boolean | null;
}

/**
 * `leadStoryId` is the lead story of the outline the sent draft was written from: `null` when that outline has
 * no lead, `undefined` when the sent draft is not known.
 */
export function issueStoryRows(content: PublishedIssueContent, leadStoryId: number | null | undefined): IssueStoryRow[] {
  const seen = new Set<number>();
  const rows: IssueStoryRow[] = [];
  for (const section of STORY_SECTION_KEYS) {
    const items: Array<{ story_id: number; url: string }> = Array.isArray(content[section]) ? content[section] : [];
    items.forEach((item, index) => {
      const storyId = item.story_id;
      // An item with a bad id, or a story seen before, gets no row but still takes its position.
      if (!Number.isSafeInteger(storyId) || storyId <= 0 || seen.has(storyId)) return;
      seen.add(storyId);
      rows.push({
        storyId,
        section,
        position: index + 1,
        url: item.url || null,
        isLead: leadStoryId === undefined ? null : storyId === leadStoryId,
      });
    });
  }
  return rows;
}
