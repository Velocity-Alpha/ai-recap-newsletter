import { LEARNED_FROM_STORIES } from "@/src/pipeline/free-links/paywall-sites";
import { prisma } from "@/src/server/prisma";

export type PaywallSiteRow = {
  site: string;
  /** How many different stories had a paywalled suggestion on the site. */
  stories: number;
  ignored: boolean;
  /** True when the paywall check treats the site as paywalled. */
  learned: boolean;
  updatedAt: Date;
};

/** Every paywall_sites row for /admin/settings. */
export async function readPaywallSites(): Promise<PaywallSiteRow[]> {
  const rows = await prisma.paywallSite.findMany({ orderBy: { site: "asc" } });
  return rows.map((row) => ({
    site: row.site,
    stories: row.storyIds.length,
    ignored: row.ignored,
    learned: !row.ignored && row.storyIds.length >= LEARNED_FROM_STORIES,
    updatedAt: row.updatedAt,
  }));
}

/** The owner says the site is not paywalled: it is never learned again. False when the site has no row. */
export async function ignorePaywallSite(site: string): Promise<boolean> {
  const { count } = await prisma.paywallSite.updateMany({ where: { site }, data: { ignored: true } });
  return count > 0;
}
