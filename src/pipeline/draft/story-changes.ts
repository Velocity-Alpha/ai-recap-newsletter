import { outlineStoryIds } from "@/src/pipeline/draft/approved-stories";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import { prisma } from "@/src/server/prisma";

/**
 * What a native commit writes to `stories`, in one transaction. n8n's `2. Public approval page` and
 * `2. Create Issue Draft` do the same today (docs/n8n-backend/30-approval-and-telegram.md):
 * - excluded stories leave the candidate pool for good (`exclude_from_candidates`);
 * - approved stories are queued for the date (`queued_for_publication_date`);
 * - the board's link and note edits are saved on the visible stories.
 * Unlike n8n, it writes only links and notes that changed, and an empty one never clears a saved one: the board
 * does not load saved notes, so an empty note means "no note", not "delete it".
 */

export interface StoryChanges {
  excluded: number;
  queued: number;
  edited: number;
}

function unique(ids: number[]): number[] {
  return [...new Set(ids)];
}

export async function applyStoryChanges(outline: ApprovalOutline): Promise<StoryChanges> {
  const excludedIds = unique(outline.excluded.map((story) => story.id));
  const approvedIds = unique(outlineStoryIds(outline));
  const boardDate = new Date(`${outline.date}T00:00:00.000Z`);
  const edits = new Map(outline.stories.map((story) => [story.id, story]));

  return prisma.$transaction(async (tx) => {
    const excluded = excludedIds.length
      ? (await tx.story.updateMany({ where: { id: { in: excludedIds } }, data: { excludeFromCandidates: true, excludedOn: boardDate } })).count
      : 0;
    const queued = approvedIds.length
      ? (await tx.story.updateMany({ where: { id: { in: approvedIds } }, data: { queuedForPublicationDate: boardDate } })).count
      : 0;

    const rows = edits.size
      ? await tx.story.findMany({ where: { id: { in: [...edits.keys()] } }, select: { id: true, url: true, note: true } })
      : [];
    let edited = 0;
    for (const row of rows) {
      const edit = edits.get(Number(row.id));
      if (!edit) continue;
      const url = edit.url?.trim() ?? "";
      const data = {
        ...(url && url !== row.url ? { url } : {}),
        ...(edit.note.trim() && edit.note !== row.note ? { note: edit.note } : {}),
      };
      if (Object.keys(data).length === 0) continue;
      await tx.story.update({ where: { id: row.id }, data });
      edited += 1;
    }
    return { excluded, queued, edited };
  });
}
