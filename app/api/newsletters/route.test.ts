import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryFns = vi.hoisted(() => ({
  fetchNewsletterListPage: vi.fn(),
}));

vi.mock("@/src/features/newsletter/repository", () => repositoryFns);

import { GET } from "@/app/api/newsletters/route";

describe("GET /api/newsletters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults invalid query params and returns list data", async () => {
    repositoryFns.fetchNewsletterListPage.mockResolvedValue({
      data: [{ id: "1", slug: "test-issue", title: "Test", excerpt: "", published_at: "2026-04-01T00:00:00.000Z", feature_image_url: null }],
      pagination: { currentPage: 1, totalPages: 2, totalCount: 7, limit: 6, hasNextPage: true, hasPreviousPage: false },
    });

    const response = await GET(new Request("http://localhost/api/newsletters?page=abc&limit=-10"));
    const json = await response.json();

    expect(repositoryFns.fetchNewsletterListPage).toHaveBeenCalledWith(1, 6);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(json.success).toBe(true);
  });

  it("returns 500 when the list query fails", async () => {
    repositoryFns.fetchNewsletterListPage.mockRejectedValue(new Error("boom"));

    const response = await GET(new Request("http://localhost/api/newsletters"));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
  });
});
