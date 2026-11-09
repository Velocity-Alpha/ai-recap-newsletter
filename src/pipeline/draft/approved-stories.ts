import type { PrismaClient } from "@/src/generated/prisma";
import { CANDIDATE_SECTION_CONFIGS, type SectionKey } from "@/src/features/newsletter/section-config";
import type { ApprovedSections, ApprovedStory } from "@/src/pipeline/draft/content";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import { prisma } from "@/src/server/prisma";

/**
 * The approved stories a draft is written from: the outline's sections, filled with the stories' rows, with the
 * board's link and note edits applied. The outline wins over the row, so a draft never depends on whether the
 * commit route has written the edits to `stories` yet.
 */

/** The `stories` columns a draft needs. */
export interface StoryRow {
  id: number;
  headline: string | null;
  summary: string | null;
  storyDetails: string | null;
  url: string | null;
  note: string | null;
}

const SECTION_KEYS: readonly string[] = CANDIDATE_SECTION_CONFIGS.map((config) => config.key);

function isSectionKey(key: string): key is SectionKey {
  return SECTION_KEYS.includes(key);
}

function emptySections(): ApprovedSections {
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, []])) as unknown as ApprovedSections;
}

/** Story ids in the outline's sections, in board order. */
export function outlineStoryIds(outline: ApprovalOutline): number[] {
  return outline.sections.flatMap((section) => section.storyIds);
}

/** Throws a plain message for an outline that cannot be drafted. */
export function toApprovedSections(outline: ApprovalOutline, rows: StoryRow[]): ApprovedSections {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const edits = new Map(outline.stories.map((story) => [story.id, story]));
  const seen = new Set<number>();
  const sections = emptySections();

  for (const section of outline.sections) {
    if (!isSectionKey(section.key)) {
      throw new Error(`The outline has a section "${section.key}" that the board does not have.`);
    }
    for (const id of section.storyIds) {
      if (seen.has(id)) throw new Error(`Story ${id} is approved in more than one section.`);
      seen.add(id);
      const row = rowsById.get(id);
      if (!row) throw new Error(`Story ${id} is in the outline but not in the database.`);
      const edit = edits.get(id);
      const url = edit?.url?.trim() || row.url?.trim() || "";
      if (!url) throw new Error(`Story ${id} has no link.`);
      const story: ApprovedStory = {
        id,
        headline: row.headline ?? "",
        summary: row.summary ?? "",
        storyDetails: row.storyDetails,
        url,
        note: edit ? edit.note : (row.note ?? ""),
      };
      sections[section.key].push(story);
    }
  }
  return sections;
}

/** Loads the outline's stories from the database and builds the approved sections. */
export async function loadApprovedSections(outline: ApprovalOutline, client: PrismaClient = prisma): Promise<ApprovedSections> {
  const rows = await client.story.findMany({
    where: { id: { in: outlineStoryIds(outline) } },
    select: { id: true, headline: true, summary: true, storyDetails: true, url: true, note: true },
  });
  return toApprovedSections(outline, rows);
}
