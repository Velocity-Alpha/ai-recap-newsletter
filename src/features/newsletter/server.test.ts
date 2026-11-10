import { beforeEach, describe, expect, it, vi } from "vitest";

const { cache, cacheOptions, revalidations, prismaMock } = vi.hoisted(() => ({
  cache: new Map<string, { value: unknown; tags: string[] }>(),
  cacheOptions: new Map<string, unknown>(),
  revalidations: [] as unknown[][],
  prismaMock: {
    $queryRaw: vi.fn(),
    issue: { findUnique: vi.fn() },
  },
}));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

// Keep framework caching observable without needing a running Next.js server.
vi.mock("next/cache", () => ({
  unstable_cache: (
    callback: (...args: unknown[]) => Promise<unknown>,
    keyParts: string[],
    options: { revalidate?: number; tags?: string[] } = {},
  ) => {
    cacheOptions.set(keyParts.join(","), options);
    return async (...args: unknown[]) => {
      const key = JSON.stringify([keyParts, args]);
      if (!cache.has(key)) {
        cache.set(key, { value: await callback(...args), tags: options.tags ?? [] });
      }
      return cache.get(key)?.value;
    };
  },
  revalidateTag: (tag: string, profile: unknown) => {
    revalidations.push([tag, profile]);
    for (const [key, entry] of cache) {
      if (entry.tags.includes(tag)) cache.delete(key);
    }
  },
}));

import { GET } from "@/app/api/newsletters/route";
import { PUBLISHED_ISSUES_TAG, refreshPublishedIssues } from "@/src/features/newsletter/cache";
import type { NewsletterListPage } from "@/src/features/newsletter/repository";
import {
  getCachedNewsletterIssueApiResponseById,
  getCachedNewsletterIssueApiResponseBySlug,
  getSafeCachedPublishedNewsletterEntries,
  getSafeCachedTickerFeed,
  getSafeNewsletterListPage,
} from "@/src/features/newsletter/server";

const existingIssueRow = {
  id: 1n,
  slug: "existing-issue",
  title: "Existing issue",
  excerpt: "Summary",
  feature_image_url: null,
  issue_date: new Date("2026-10-19T00:00:00.000Z"),
  published_at: new Date("2026-10-19T16:00:00.000Z"),
  total_count: 1,
};

describe("newsletter page data", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cache.clear();
    revalidations.length = 0;
  });

  const newlyPublishedRows = [
    {
      ...existingIssueRow,
      id: 2n,
      slug: "newly-published-issue",
      title: "Newly published issue",
      issue_date: new Date("2026-10-20T00:00:00.000Z"),
      published_at: new Date("2026-10-20T16:00:00.000Z"),
      total_count: 2,
    },
    { ...existingIssueRow, total_count: 2 },
  ];

  it("shows a newly published issue on the next list API read", async () => {
    const readList = async (): Promise<NewsletterListPage> => {
      const response = await GET(new Request("http://localhost/api/newsletters?page=1&limit=6"));
      expect(response.status).toBe(200);
      return response.json();
    };
    prismaMock.$queryRaw.mockResolvedValueOnce([existingIssueRow]);

    const beforePublish = await readList();
    expect(beforePublish.data.map((issue) => issue.title)).toEqual(["Existing issue"]);

    prismaMock.$queryRaw.mockResolvedValueOnce(newlyPublishedRows);

    const afterPublish = await readList();
    expect(afterPublish.data.map((issue) => issue.title)).toEqual([
      "Newly published issue",
      "Existing issue",
    ]);
    expect(afterPublish.pagination.totalCount).toBe(2);
  });

  it("keeps the page list cached until published issues are refreshed", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([existingIssueRow]);
    const beforePublish = await getSafeNewsletterListPage(1, 6);
    expect(beforePublish.data.map((issue) => issue.title)).toEqual(["Existing issue"]);

    prismaMock.$queryRaw.mockResolvedValueOnce(newlyPublishedRows);
    await expect(getSafeNewsletterListPage(1, 6)).resolves.toEqual(beforePublish);

    refreshPublishedIssues();

    const afterRefresh = await getSafeNewsletterListPage(1, 6);
    expect(afterRefresh.data.map((issue) => issue.title)).toEqual(["Newly published issue", "Existing issue"]);
    expect(afterRefresh.pagination.totalCount).toBe(2);
  });

  it("refreshes an issue page that was looked up before it was published", async () => {
    prismaMock.issue.findUnique.mockResolvedValueOnce(null);
    await expect(getCachedNewsletterIssueApiResponseBySlug("newly-published-issue")).resolves.toBeNull();

    prismaMock.issue.findUnique.mockResolvedValueOnce({
      id: 2n,
      slug: "newly-published-issue",
      title: "Newly published issue",
      excerpt: "Summary",
      featureImageUrl: null,
      contentJson: { version: 2 },
      issueDate: new Date("2026-10-20T00:00:00.000Z"),
      publishedAt: new Date("2026-10-20T16:00:00.000Z"),
      status: "published",
    });
    refreshPublishedIssues();

    const issue = await getCachedNewsletterIssueApiResponseBySlug("newly-published-issue");
    expect(issue?.title).toBe("Newly published issue");
  });

  it("tags every published-issue cache and keeps it for at most an hour", () => {
    const tagged = { revalidate: 3600, tags: [PUBLISHED_ISSUES_TAG] };

    expect(Object.fromEntries(cacheOptions)).toMatchObject({
      "published-newsletter-list-page": tagged,
      "published-newsletter-issue-by-id": tagged,
      "published-newsletter-issue-by-slug": tagged,
      "newsletter-published-entries": tagged,
    });
  });

  it("expires the tag at once, so the next visitor waits for fresh data instead of seeing the old list", () => {
    refreshPublishedIssues();

    expect(revalidations).toContainEqual([PUBLISHED_ISSUES_TAG, { expire: 0 }]);
  });

  it("returns an empty page during a database error and recovers on the next read", async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error("Database unavailable"));

    await expect(getSafeNewsletterListPage(2, 6)).resolves.toEqual({
      data: [],
      pagination: {
        currentPage: 2,
        totalPages: 0,
        totalCount: 0,
        limit: 6,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    // The failure is not cached: the same page reads the database again.
    prismaMock.$queryRaw.mockResolvedValueOnce([existingIssueRow]);
    const recovered = await getSafeNewsletterListPage(2, 6);
    expect(recovered.data[0].title).toBe("Existing issue");
  });

  it.each([
    { name: "ID", readIssue: () => getCachedNewsletterIssueApiResponseById(1) },
    { name: "slug", readIssue: () => getCachedNewsletterIssueApiResponseBySlug("existing-issue") },
  ])("keeps individual issue lookups cached by $name", async ({ readIssue }) => {
    const issueRecord = {
      id: 1n,
      slug: "existing-issue",
      title: "Existing issue",
      excerpt: "Summary",
      featureImageUrl: null,
      contentJson: { version: 2 },
      issueDate: new Date("2026-10-19T00:00:00.000Z"),
      publishedAt: new Date("2026-10-19T16:00:00.000Z"),
      status: "published",
    };
    prismaMock.issue.findUnique.mockResolvedValueOnce(issueRecord);

    const original = await readIssue();
    expect(original?.title).toBe("Existing issue");

    prismaMock.issue.findUnique.mockResolvedValueOnce({ ...issueRecord, title: "Edited issue" });
    await expect(readIssue()).resolves.toEqual(original);
  });

  it("keeps sitemap entries cached", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([existingIssueRow]);

    const original = await getSafeCachedPublishedNewsletterEntries();
    expect(original[0].slug).toBe("existing-issue");

    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    await expect(getSafeCachedPublishedNewsletterEntries()).resolves.toEqual(original);
  });

  it("keeps ticker stories and stats cached", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ stories: 1, tools: 0, papers: 0 }])
      .mockResolvedValueOnce([{ headline: "Cached story", day: null, category: "Industry", createdAt: null }]);

    const original = await getSafeCachedTickerFeed();
    expect(original.data[0].headline).toBe("Cached story");
    expect(original.stats.stories).toBe(1);

    prismaMock.$queryRaw.mockResolvedValue([]);
    await expect(getSafeCachedTickerFeed()).resolves.toEqual(original);
  });
});
