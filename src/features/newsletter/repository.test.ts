import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/db", () => ({
  getPool: () => ({
    query: queryMock,
  }),
}));

import {
  fetchNewsletterIssueApiResponseById,
  fetchNewsletterIssueApiResponseBySlug,
  fetchNewsletterListPage,
  fetchTickerFeed,
} from "@/src/features/newsletter/repository";

describe("newsletter repository", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("normalizes pagination inputs and maps newsletter list rows", async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 12,
          slug: "issue-12",
          title: "Issue 12",
          excerpt: "Summary",
          feature_image_url: "https://example.com/image.png",
          issue_date: "2026-04-01",
          published_at: "2026-04-01T12:00:00.000Z",
          total_count: 11,
        },
      ],
    });

    const result = await fetchNewsletterListPage(-10, 500);

    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("WITH filtered AS"), [100, 0]);
    expect(result).toEqual({
      data: [
        {
          id: "12",
          slug: "issue-12",
          title: "Issue 12",
          excerpt: "Summary",
          issue_date: "2026-04-01",
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

  it("returns null when a newsletter issue lookup misses", async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await expect(fetchNewsletterIssueApiResponseById(999)).resolves.toBeNull();
    await expect(fetchNewsletterIssueApiResponseBySlug("missing-issue")).resolves.toBeNull();
  });

  it("maps ticker stories and stats from the database", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ stories: 7, tools: 3, papers: 2 }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            headline: "A story",
            day: "2026-04-02",
            category: "Product",
            createdAt: "2026-04-02T09:00:00.000Z",
          },
        ],
      });

    const result = await fetchTickerFeed();

    expect(result).toEqual({
      data: [
        {
          headline: "A story",
          day: "2026-04-02",
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
