import { prisma } from "@/src/server/prisma";

/**
 * The store of the learned paywalled sites (#59), table `paywall_sites`. The article reader finds a suggested
 * link paywalled; the site of that link gets the story's id. A site with 2 or more story ids that the owner did
 * not ignore is a learned paywalled site.
 */

/** A site is learned once this many different stories had a paywalled suggestion there. */
export const LEARNED_FROM_STORIES = 2;

/** The learned paywalled sites, by name. The paywall check treats them like its own list of paywalled sites. */
export async function learnedSites(): Promise<string[]> {
  const rows = await prisma.paywallSite.findMany({ where: { ignored: false }, orderBy: { site: "asc" } });
  return rows.filter(isLearned).map((row) => row.site);
}

/** The one rule for a learned paywalled site. */
export function isLearned(row: { storyIds: readonly number[]; ignored: boolean }): boolean {
  return !row.ignored && row.storyIds.length >= LEARNED_FROM_STORIES;
}

/**
 * The learned paywalled sites, or none when they cannot be read. They only make the paywall check better, so
 * ingestion, a commit and a typed link's check go on without them. The failure is logged.
 */
export async function learnedSitesOrNone(read: () => Promise<string[]> = learnedSites): Promise<string[]> {
  try {
    return await read();
  } catch (error) {
    console.error(`[free-links] Could not read the learned paywalled sites: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** Notes that the article reader found a suggested link of this story paywalled on the site. */
export async function recordPaywalledSite(site: string, storyId: number): Promise<void> {
  await prisma.paywallSite.createMany({ data: [{ site }], skipDuplicates: true });
  // One statement adds the story only when it is not there yet, so `story_ids` stays distinct under parallel calls.
  await prisma.paywallSite.updateMany({
    where: { site, NOT: { storyIds: { has: storyId } } },
    data: { storyIds: { push: storyId } },
  });
}
