import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  issue: {
    findUnique: vi.fn(),
  },
}));

vi.mock("@/src/server/prisma", () => ({
  prisma: prismaMock,
}));

import {
  fetchNewsletterIssueApiResponseById,
  fetchNewsletterIssueApiResponseBySlug,
  fetchNewsletterListPage,
  fetchPublishedNewsletterEntries,
  fetchTickerFeed,
} from "@/src/features/newsletter/repository";

describe("newsletter repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes pagination inputs and maps newsletter list rows", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        id: 12n,
        slug: "issue-12",
        title: "Issue 12",
        excerpt: "Summary",
        feature_image_url: "https://example.com/image.png",
        issue_date: new Date("2026-04-01T00:00:00.000Z"),
        published_at: new Date("2026-04-01T12:00:00.000Z"),
        total_count: 11,
      },
    ]);

    const result = await fetchNewsletterListPage(-10, 500);

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      data: [
        {
          id: "12",
          slug: "issue-12",
          title: "Issue 12",
          excerpt: "Summary",
          issue_date: "2026-04-01T00:00:00.000Z",
          published_at: "2026-04-01T12:00:00.000Z",
          feature_image_url: "https://example.com/image.png",
        },
      ],
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalCount: 11,
        limit: 100,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  });

  it("maps published newsletter entries", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        id: 100n,
        slug: "latest-issue",
        published_at: new Date("2026-04-02T12:00:00.000Z"),
        issue_date: new Date("2026-04-02T00:00:00.000Z"),
      },
    ]);

    await expect(fetchPublishedNewsletterEntries()).resolves.toEqual([
      {
        id: "100",
        slug: "latest-issue",
        published_at: "2026-04-02T12:00:00.000Z",
        issue_date: "2026-04-02T00:00:00.000Z",
      },
    ]);
  });

  it("returns null when a newsletter issue lookup misses", async () => {
    prismaMock.issue.findUnique.mockResolvedValue(null);

    await expect(fetchNewsletterIssueApiResponseById(999)).resolves.toBeNull();
    await expect(fetchNewsletterIssueApiResponseBySlug("missing-issue")).resolves.toBeNull();
  });

  it("maps issue lookups by id and slug", async () => {
    prismaMock.issue.findUnique
      .mockResolvedValueOnce({
        id: 5n,
        slug: "issue-5",
        title: "Issue 5",
        excerpt: null,
        featureImageUrl: "https://example.com/feature.png",
        contentJson: { blocks: [] },
        issueDate: new Date("2026-04-03T00:00:00.000Z"),
        publishedAt: new Date("2026-04-03T12:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: 6n,
        slug: "issue-6",
        title: "Issue 6",
        excerpt: "Summary",
        featureImageUrl: null,
        contentJson: { blocks: ["story"] },
        issueDate: null,
        publishedAt: new Date("2026-04-04T12:00:00.000Z"),
      });

    await expect(fetchNewsletterIssueApiResponseById(5)).resolves.toEqual({
      id: 5,
      slug: "issue-5",
      title: "Issue 5",
      excerpt: "",
      feature_image_url: "https://example.com/feature.png",
      content_json: { blocks: [] },
      issue_date: "2026-04-03T00:00:00.000Z",
      published_at: "2026-04-03T12:00:00.000Z",
    });

    await expect(fetchNewsletterIssueApiResponseBySlug("issue-6")).resolves.toEqual({
      id: 6,
      slug: "issue-6",
      title: "Issue 6",
      excerpt: "Summary",
      feature_image_url: null,
      content_json: { blocks: ["story"] },
      issue_date: null,
      published_at: "2026-04-04T12:00:00.000Z",
    });
  });

  it("maps ticker stories and stats from the database", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ stories: 7, tools: 3, papers: 2 }])
      .mockResolvedValueOnce([
        {
          headline: "A story",
          day: new Date("2026-04-02T00:00:00.000Z"),
          category: "Product",
          createdAt: new Date("2026-04-02T09:00:00.000Z"),
        },
      ]);

    const result = await fetchTickerFeed();

    expect(result).toEqual({
      data: [
        {
          headline: "A story",
          day: "2026-04-02T00:00:00.000Z",
          category: "Product",
          createdAt: "2026-04-02T09:00:00.000Z",
        },
      ],
      stats: {
        stories: 7,
        tools: 3,
        papers: 2,
      },
      count: 1,
    });
  });
});
