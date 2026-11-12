import { unstable_cache } from "next/cache";

import { PUBLISHED_ISSUES_MAX_AGE_SECONDS, PUBLISHED_ISSUES_TAG } from "@/src/features/newsletter/cache";
import { parseNewsletterIssue } from "@/src/features/newsletter/parsers";
import type { NewsletterIssueApiResponse, ParsedNewsletterIssue } from "@/src/features/newsletter/types";
import {
  type PublishedNewsletterEntry,
  fetchNewsletterIssueApiResponseById,
  fetchNewsletterIssueApiResponseBySlug,
  fetchNewsletterListPage,
  fetchPublishedNewsletterEntries,
  fetchTickerFeed,
} from "@/src/features/newsletter/repository";

// Published-issue data is cached for up to an hour and refreshed at once when an issue publishes
// (refreshPublishedIssues). The "published-" key prefix keeps entries cached before lookups were limited to
// published issues from being reused.
const publishedIssuesCache = { revalidate: PUBLISHED_ISSUES_MAX_AGE_SECONDS, tags: [PUBLISHED_ISSUES_TAG] };

export const getCachedNewsletterIssueApiResponseById = unstable_cache(
  async (id: number) => fetchNewsletterIssueApiResponseById(id),
  ["published-newsletter-issue-by-id"],
  publishedIssuesCache,
);

export const getCachedNewsletterIssueApiResponseBySlug = unstable_cache(
  async (slug: string) => fetchNewsletterIssueApiResponseBySlug(slug),
  ["published-newsletter-issue-by-slug"],
  publishedIssuesCache,
);

export const getCachedPublishedNewsletterEntries = unstable_cache(
  async () => fetchPublishedNewsletterEntries(),
  ["newsletter-published-entries"],
  publishedIssuesCache,
);

/** Throws when the database cannot be read, so a cached page keeps its last good copy instead of an empty list. */
export const getCachedNewsletterListPage = unstable_cache(
  async (page: number, limit: number) => fetchNewsletterListPage(page, limit),
  ["published-newsletter-list-page"],
  publishedIssuesCache,
);

export const getCachedTickerFeed = unstable_cache(
  async () => fetchTickerFeed(),
  ["newsletter-ticker-feed"],
  { revalidate: 300 },
);

export async function getSafeCachedPublishedNewsletterEntries(): Promise<PublishedNewsletterEntry[]> {
  try {
    return await getCachedPublishedNewsletterEntries();
  } catch {
    return [];
  }
}

export async function fetchNewsletterIssueById(id: string): Promise<ParsedNewsletterIssue | null> {
  try {
    const issueId = Number.parseInt(id, 10);
    if (!Number.isFinite(issueId) || issueId <= 0) {
      return null;
    }

    const data = (await getCachedNewsletterIssueApiResponseById(issueId)) as NewsletterIssueApiResponse | null;
    if (!data) {
      return null;
    }

    return parseNewsletterIssue(data);
  } catch {
    return null;
  }
}

/**
 * Null when no published issue has this slug. A failed read throws, so a cached issue page keeps its last good
 * copy instead of caching "not found".
 */
export async function fetchNewsletterIssueBySlug(slug: string): Promise<ParsedNewsletterIssue | null> {
  if (!slug.trim()) {
    return null;
  }

  const data = (await getCachedNewsletterIssueApiResponseBySlug(slug)) as NewsletterIssueApiResponse | null;
  if (!data) {
    return null;
  }

  return parseNewsletterIssue(data);
}
