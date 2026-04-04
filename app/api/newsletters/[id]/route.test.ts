import { beforeEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({
  getCachedNewsletterIssueApiResponseById: vi.fn(),
}));

vi.mock("@/src/features/newsletter/server", () => serverFns);

import { GET } from "@/app/api/newsletters/[id]/route";

describe("GET /api/newsletters/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid ids", async () => {
    const response = await GET(new Request("http://localhost/api/newsletters/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid ID");
    expect(serverFns.getCachedNewsletterIssueApiResponseById).not.toHaveBeenCalled();
  });

  it("returns 404 when an issue is missing", async () => {
    serverFns.getCachedNewsletterIssueApiResponseById.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/newsletters/5"), {
      params: Promise.resolve({ id: "5" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns issue data when found", async () => {
    serverFns.getCachedNewsletterIssueApiResponseById.mockResolvedValue({
      id: 5,
      slug: "test-issue",
      title: "Test",
      excerpt: "Summary",
      content_json: {},
    });

    const response = await GET(new Request("http://localhost/api/newsletters/5"), {
      params: Promise.resolve({ id: "5" }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600, stale-while-revalidate=300");
    expect(json.data.id).toBe(5);
  });
});
