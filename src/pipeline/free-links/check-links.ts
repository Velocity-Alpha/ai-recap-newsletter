import { readArticles, type ReadArticlesOptions } from "@/src/pipeline/draft/articles/read-articles";
import { recordPaywalledSite } from "@/src/pipeline/free-links/paywall-sites";
import { MAX_LINKS, MIN_WORDS, SKIPPED_SITES, siteOf } from "@/src/pipeline/free-links/sites";
import { checkSiteList, isOnSiteList } from "@/src/pipeline/ingest/paywall";

/**
 * The check of the links that could be a story's free links (#59). A link is kept when the article reader gets
 * an article of MIN_WORDS words or more from it. The cheap rules come first, so a link on a site that can never
 * be a free link is not read.
 */

/**
 * The step's limit for reading all links of one story: the draft step's 120 s, so a link whose page method uses its
 * limits still gets to Jina. The free link job is a background function (15 minutes).
 */
export const READ_DEADLINE_MS = 120_000;

export interface LinkCandidate {
  url: string;
  title?: string | null;
}

/** A free link: a link that was read as a full article. */
export interface CheckedLink {
  url: string;
  site: string;
  title: string | null;
  words: number;
}

/** What the check needs from one read of the article reader. */
export interface LinkRead {
  url: string;
  status: string;
  text: string | null;
}

export interface CheckLinksDeps {
  /** Reads the links, all at once. Defaults to the article reader, with READ_DEADLINE_MS for the whole step. */
  read?: (urls: string[]) => Promise<LinkRead[]>;
  readOptions?: ReadArticlesOptions;
  /** The learned paywalled sites. They count like the list of paywalled sites. */
  learnedSites?: readonly string[];
  recordPaywalledSite?: (site: string, storyId: number) => Promise<void>;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

async function readWithArticleReader(urls: string[], options: ReadArticlesOptions = {}): Promise<LinkRead[]> {
  const { reads } = await readArticles(urls.map((url, index) => ({ id: index, url })), { deadlineMs: READ_DEADLINE_MS, ...options });
  return reads;
}

/**
 * The free links among the candidates, at most MAX_LINKS, in the given order. `story.url` is the paywalled link.
 * A link the reader finds paywalled is recorded for its site, so the site can become a learned paywalled site.
 */
export async function checkLinks(story: { id: number; url: string }, candidates: LinkCandidate[], deps: CheckLinksDeps = {}): Promise<CheckedLink[]> {
  const originalSite = siteOf(story.url);
  const toRead = new Map<string, { site: string; title: string | null }>();
  for (const candidate of candidates) {
    const site = siteOf(candidate.url);
    if (!site || site === originalSite || toRead.has(candidate.url)) continue;
    if (isOnSiteList(site, SKIPPED_SITES)) continue;
    if (checkSiteList(candidate.url, deps.learnedSites) === "yes") continue;
    toRead.set(candidate.url, { site, title: candidate.title?.trim() || null });
  }
  if (toRead.size === 0) return [];

  const read = deps.read ?? ((urls: string[]) => readWithArticleReader(urls, deps.readOptions));
  const record = deps.recordPaywalledSite ?? recordPaywalledSite;
  const reads = new Map((await read([...toRead.keys()])).map((result) => [result.url, result]));

  const links: CheckedLink[] = [];
  for (const [url, { site, title }] of toRead) {
    const result = reads.get(url);
    if (result?.status === "paywalled") await record(site, story.id);
    if (result?.status !== "read" || !result.text) continue;
    const words = countWords(result.text);
    if (words >= MIN_WORDS && links.length < MAX_LINKS) links.push({ url, site, title, words });
  }
  return links;
}
