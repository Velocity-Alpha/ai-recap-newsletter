// The CDN caches the home page and issue pages. A failed data read must throw, so Next.js keeps serving the last
// good page instead of caching an empty home page or a "not found" issue.
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  fetchNewsletterListPage: vi.fn(),
  fetchTickerFeed: vi.fn(),
  fetchNewsletterIssueApiResponseBySlug: vi.fn(),
  fetchNewsletterIssueApiResponseById: vi.fn(),
  fetchPublishedNewsletterEntries: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: (...args: unknown[]) => Promise<unknown>) => callback,
}));
vi.mock("@/src/features/newsletter/repository", () => repository);
vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import * as HomePageModule from "@/app/page";
import * as IssuePageModule from "@/app/issue/[slug]/page";

const databaseDown = new Error("database unavailable");

describe("cached public pages", () => {
  beforeEach(() => {
    repository.fetchNewsletterListPage.mockReset().mockResolvedValue({
      data: [],
      pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 6, hasNextPage: false, hasPreviousPage: false },
    });
    repository.fetchTickerFeed.mockReset().mockResolvedValue({ data: [], stats: { stories: 0, tools: 0, papers: 0 }, count: 0 });
    repository.fetchNewsletterIssueApiResponseBySlug.mockReset();
  });

  it("refreshes the home page every 5 minutes, the ticker's lifetime", () => {
    expect(HomePageModule.revalidate).toBe(300);
  });

  it("does not render the home page when the issue list read fails", async () => {
    repository.fetchNewsletterListPage.mockRejectedValue(databaseDown);

    await expect(HomePageModule.default()).rejects.toThrow("database unavailable");
  });

  it("does not render the home page when the ticker read fails", async () => {
    repository.fetchTickerFeed.mockRejectedValue(databaseDown);

    await expect(HomePageModule.default()).rejects.toThrow("database unavailable");
  });

  it("caches issue pages for up to an hour, built on first visit with no build-time reads", async () => {
    expect(IssuePageModule.revalidate).toBe(3600);
    expect(IssuePageModule.dynamicParams).toBe(true);
    await expect(IssuePageModule.generateStaticParams()).resolves.toEqual([]);
    expect(repository.fetchNewsletterIssueApiResponseBySlug).not.toHaveBeenCalled();
  });

  it("does not render an issue page as not found when the issue read fails", async () => {
    repository.fetchNewsletterIssueApiResponseBySlug.mockRejectedValue(databaseDown);
    const props = { params: Promise.resolve({ slug: "some-issue" }) };

    await expect(IssuePageModule.default(props)).rejects.toThrow("database unavailable");
    await expect(IssuePageModule.generateMetadata(props)).rejects.toThrow("database unavailable");
  });
});
