import { outlineStoryIds } from "@/src/pipeline/draft/approved-stories";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import { learnedSites, learnedSitesOrNone } from "@/src/pipeline/free-links/paywall-sites";
import { checkPaywall, guardedFetch, OWNER_CHECK_TIMEOUT_MS, type PaywallResult } from "@/src/pipeline/ingest/paywall";
import { prisma } from "@/src/server/prisma";

/**
 * What a native commit writes to `stories`. n8n's `2. Public approval page` and `2. Create Issue Draft` did the
 * same (docs/n8n-backend/30-approval-and-telegram.md):
 * - excluded stories leave the candidate pool for good (`exclude_from_candidates`);
 * - approved stories are queued for the date (`queued_for_publication_date`);
 * - the board's link and note edits are saved on the visible stories.
 * Unlike n8n, it writes only links and notes that changed, and an empty one never clears a saved one: the board
 * does not load saved notes, so an empty note means "no note", not "delete it".
 *
 * When a story's link changes (#59), the commit also
 * - keeps the old link in `original_url`, the first time only, so the original link is never lost;
 * - sets `paywall_detected` for the new link: "no" when it is a free link of the story (`story_free_links`),
 *   otherwise the answer of the paywall check, with its `error`. The lock icon is then right on later boards.
 * The paywall checks open pages, so they run first, each with a 5 second limit. All the writes then happen in
 * one transaction. A commit never fails for the check: when the free links or the learned paywalled sites
 * cannot be read, the link is checked without them.
 */

export interface StoryChanges {
  excluded: number;
  queued: number;
  edited: number;
}

export interface StoryChangeDeps {
  /** Opens the page of a typed link for the paywall check. */
  fetch?: typeof fetch;
  learnedSites?: () => Promise<string[]>;
}

type LinkChange = { id: number; url: string };

const FREE_LINK: PaywallResult = { status: "no", error: "" };

function unique(ids: number[]): number[] {
  return [...new Set(ids)];
}

/** The paywall state of each new link, by story id. */
async function checkNewLinks(changes: LinkChange[], deps: StoryChangeDeps): Promise<Map<number, PaywallResult>> {
  if (changes.length === 0) return new Map();
  const freeLinks = await prisma.storyFreeLink
    .findMany({ where: { storyId: { in: changes.map((change) => change.id) } }, select: { storyId: true, url: true } })
    .catch((error: unknown) => {
      console.error(`[free-links] Could not read the free links: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
  const isFreeLink = (change: LinkChange) => freeLinks.some((link) => link.storyId === change.id && link.url === change.url);
  const sites = changes.every(isFreeLink) ? [] : await learnedSitesOrNone(deps.learnedSites ?? learnedSites);
  const send = deps.fetch ?? guardedFetch();
  return new Map(
    await Promise.all(
      changes.map(
        async (change) =>
          [change.id, isFreeLink(change) ? FREE_LINK : await checkPaywall(change.url, { fetch: send, learnedSites: sites, timeoutMs: OWNER_CHECK_TIMEOUT_MS })] as const,
      ),
    ),
  );
}

export async function applyStoryChanges(outline: ApprovalOutline, deps: StoryChangeDeps = {}): Promise<StoryChanges> {
  const excludedIds = unique(outline.excluded.map((story) => story.id));
  const approvedIds = unique(outlineStoryIds(outline));
  const boardDate = new Date(`${outline.date}T00:00:00.000Z`);
  const edits = new Map(outline.stories.map((story) => [story.id, story]));

  const rows = edits.size
    ? await prisma.story.findMany({ where: { id: { in: [...edits.keys()] } }, select: { id: true, url: true, note: true, originalUrl: true } })
    : [];
  const newLink = (row: (typeof rows)[number]): string | null => {
    const url = edits.get(Number(row.id))?.url?.trim() ?? "";
    return url && url !== row.url ? url : null;
  };
  const paywall = await checkNewLinks(
    rows.flatMap((row) => {
      const url = newLink(row);
      return url ? [{ id: Number(row.id), url }] : [];
    }),
    deps,
  );

  return prisma.$transaction(async (tx) => {
    const excluded = excludedIds.length
      ? (await tx.story.updateMany({ where: { id: { in: excludedIds } }, data: { excludeFromCandidates: true, excludedOn: boardDate } })).count
      : 0;
    const queued = approvedIds.length
      ? (await tx.story.updateMany({ where: { id: { in: approvedIds } }, data: { queuedForPublicationDate: boardDate } })).count
      : 0;

    let edited = 0;
    for (const row of rows) {
      const edit = edits.get(Number(row.id));
      if (!edit) continue;
      const url = newLink(row);
      const checked = paywall.get(Number(row.id));
      const data = {
        ...(url ? { url } : {}),
        ...(url && row.url && row.originalUrl === null ? { originalUrl: row.url } : {}),
        ...(url && checked ? { paywallDetected: checked.status, error: checked.error } : {}),
        ...(edit.note.trim() && edit.note !== row.note ? { note: edit.note } : {}),
      };
      if (Object.keys(data).length === 0) continue;
      await tx.story.update({ where: { id: row.id }, data });
      edited += 1;
    }
    return { excluded, queued, edited };
  });
}
