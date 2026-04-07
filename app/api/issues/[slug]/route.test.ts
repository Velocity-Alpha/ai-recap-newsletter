import { beforeEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({
  getCachedNewsletterIssueApiResponseBySlug: vi.fn(),
}));

vi.mock("@/features/newsletter/server", () => serverFns);

import { GET } from "./route";

describe("GET /api/issues/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects blank slugs", async () => {
    const response = await GET(new Request("http://localhost/api/issues/%20"), {
      params: Promise.resolve({ slug: "   " }),
    });

    expect(response.status).toBe(400);
  });

  it("returns 404 when a slug is missing", async () => {
    serverFns.getCachedNewsletterIssueApiResponseBySlug.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/issues/test-issue"), {
      params: Promise.resolve({ slug: "test-issue" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns issue data when found", async () => {
    serverFns.getCachedNewsletterIssueApiResponseBySlug.mockResolvedValue({
      id: 9,
      slug: "test-issue",
      title: "Test",
      excerpt: "Summary",
      content_json: {},
    });

    const response = await GET(new Request("http://localhost/api/issues/test-issue"), {
      params: Promise.resolve({ slug: "test-issue" }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600, stale-while-revalidate=300");
    expect(json.data.slug).toBe("test-issue");
  });
});
