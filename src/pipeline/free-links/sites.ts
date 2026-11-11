/**
 * Sites, for the free links of a paywalled story (#59): how a link's site is named, and which sites a free link
 * can never be on. No database and no network here, so the board can use it in the browser. The store of the
 * learned paywalled sites is paywall-sites.ts.
 */

/** Social and aggregator sites. A free link is an article, so a link on one of these is dropped unread. */
export const SKIPPED_SITES = [
  "reddit.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "threads.net",
  "tiktok.com",
  "news.ycombinator.com",
];
/** A free link has this many words or more. */
export const MIN_WORDS = 300;
/** Most stories in one request for free links: more than a board shows. The board sends more in parts. */
export const MAX_STORY_IDS = 60;
/** Most free links kept for one story. */
export const MAX_LINKS = 3;

/** The site of a link: its host name in lower case, without `www.`. Null when it is not an http(s) link. */
export function siteOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}
