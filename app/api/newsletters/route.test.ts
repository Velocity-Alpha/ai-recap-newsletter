import { beforeEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({
  getCachedNewsletterListPage: vi.fn(),
}));

vi.mock("@/src/features/newsletter/server", () => serverFns);

import { GET } from "@/app/api/newsletters/route";

describe("GET /api/newsletters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults invalid query params and returns list data", async () => {
    serverFns.getCachedNewsletterListPage.mockResolvedValue({
      data: [{ id: "1", slug: "test-issue", title: "Test", excerpt: "", published_at: "2026-04-01T00:00:00.000Z", feature_image_url: null }],
      pagination: { currentPage: 1, totalPages: 2, totalCount: 7, limit: 6, hasNextPage: true, hasPreviousPage: false },
    });

    const response = await GET(new Request("http://localhost/api/newsletters?page=abc&limit=-10"));
    const json = await response.json();

    expect(serverFns.getCachedNewsletterListPage).toHaveBeenCalledWith(1, 6);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600, stale-while-revalidate=300");
    expect(json.success).toBe(true);
  });

  it("returns 500 when the server helper fails", async () => {
    serverFns.getCachedNewsletterListPage.mockRejectedValue(new Error("boom"));

    const response = await GET(new Request("http://localhost/api/newsletters"));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
  });
});
