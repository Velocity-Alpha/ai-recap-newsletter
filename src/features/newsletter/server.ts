import { unstable_cache } from "next/cache";

import { parseNewsletterIssue } from "@/src/features/newsletter/parsers";
import type { NewsletterIssueApiResponse, ParsedNewsletterIssue } from "@/src/features/newsletter/types";
import {
  type NewsletterListPage,
  type PublishedNewsletterEntry,
  type TickerFeed,
  fetchNewsletterIssueApiResponseById,
  fetchNewsletterIssueApiResponseBySlug,
  fetchNewsletterListPage,
  fetchPublishedNewsletterEntries,
  fetchTickerFeed,
} from "@/src/features/newsletter/repository";

export const getCachedNewsletterIssueApiResponseById = unstable_cache(
  async (id: number) => fetchNewsletterIssueApiResponseById(id),
  ["newsletter-issue-by-id"],
  { revalidate: 3600 },
);

export const getCachedNewsletterIssueApiResponseBySlug = unstable_cache(
  async (slug: string) => fetchNewsletterIssueApiResponseBySlug(slug),
  ["newsletter-issue-by-slug"],
  { revalidate: 3600 },
);

export const getCachedNewsletterListPage = unstable_cache(
  async (page: number, limit: number) => fetchNewsletterListPage(page, limit),
  ["newsletter-list-page"],
  { revalidate: 3600 },
);

export const getCachedPublishedNewsletterEntries = unstable_cache(
  async () => fetchPublishedNewsletterEntries(),
  ["newsletter-published-entries"],
  { revalidate: 3600 },
);

export const getCachedTickerFeed = unstable_cache(
  async () => fetchTickerFeed(),
  ["newsletter-ticker-feed"],
  { revalidate: 300 },
);

export async function getSafeCachedNewsletterListPage(page: number, limit: number): Promise<NewsletterListPage> {
  try {
    return await getCachedNewsletterListPage(page, limit);
  } catch {
    return {
      data: [],
      pagination: {
        currentPage: Math.max(1, Math.trunc(page) || 1),
        totalPages: 0,
        totalCount: 0,
        limit: Math.max(1, Math.trunc(limit) || 6),
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }
}

export async function getSafeCachedPublishedNewsletterEntries(): Promise<PublishedNewsletterEntry[]> {
  try {
    return await getCachedPublishedNewsletterEntries();
  } catch {
    return [];
  }
}

export async function getSafeCachedTickerFeed(): Promise<TickerFeed> {
  try {
    return await getCachedTickerFeed();
  } catch {
    return {
      data: [],
      stats: {
        stories: 0,
        tools: 0,
        papers: 0,
      },
      count: 0,
    };
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

export async function fetchNewsletterIssueBySlug(slug: string): Promise<ParsedNewsletterIssue | null> {
  try {
    if (!slug.trim()) {
      return null;
    }

    const data = (await getCachedNewsletterIssueApiResponseBySlug(slug)) as NewsletterIssueApiResponse | null;
    if (!data) {
      return null;
    }

    return parseNewsletterIssue(data);
  } catch {
    return null;
  }
}
