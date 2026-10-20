import { beforeEach, describe, expect, it, vi } from "vitest";

const { cache, prismaMock } = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
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
  ) => async (...args: unknown[]) => {
    const key = JSON.stringify([keyParts, args]);
    if (!cache.has(key)) {
      cache.set(key, await callback(...args));
    }
    return cache.get(key);
  },
}));

import { GET } from "@/app/api/newsletters/route";
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
  });

  it.each([
    { name: "page loader", readList: () => getSafeNewsletterListPage(1, 6) },
    {
      name: "list API",
      readList: async (): Promise<NewsletterListPage> => {
        const response = await GET(new Request("http://localhost/api/newsletters?page=1&limit=6"));
        expect(response.status).toBe(200);
        return response.json();
      },
    },
  ])("shows a newly published issue on the next $name read", async ({ readList }) => {
    prismaMock.$queryRaw.mockResolvedValueOnce([existingIssueRow]);

    const beforePublish = await readList();
    expect(beforePublish.data.map((issue) => issue.title)).toEqual(["Existing issue"]);

    prismaMock.$queryRaw.mockResolvedValueOnce([
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
    ]);

    const afterPublish = await readList();
    expect(afterPublish.data.map((issue) => issue.title)).toEqual([
      "Newly published issue",
      "Existing issue",
    ]);
    expect(afterPublish.pagination.totalCount).toBe(2);
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

    prismaMock.$queryRaw.mockResolvedValueOnce([existingIssueRow]);
    const recovered = await getSafeNewsletterListPage(1, 6);
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
