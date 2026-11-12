import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ refreshPublishedIssues: vi.fn() }));
const repository = vi.hoisted(() => ({ fetchPublishedNewsletterEntries: vi.fn() }));

vi.mock("@/src/features/newsletter/cache", () => ({
  PUBLISHED_ISSUES_TAG: "published-issues",
  refreshPublishedIssues: cache.refreshPublishedIssues,
}));

vi.mock("@/src/features/newsletter/repository", () => ({
  fetchPublishedNewsletterEntries: repository.fetchPublishedNewsletterEntries,
}));

import { POST } from "@/app/api/revalidate/route";
import { createCacheRefreshToken } from "@/src/server/cache-refresh-auth";

function request(authorization?: string) {
  return new Request("http://localhost/api/revalidate", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("POST /api/revalidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
    repository.fetchPublishedNewsletterEntries.mockResolvedValue([
      { id: "12", slug: "ai-recap-2026-11-12", published_at: "2026-11-12T15:00:00.000Z", issue_date: "2026-11-12" },
      { id: "11", slug: "ai-recap-2026-11-11", published_at: "2026-11-11T15:00:00.000Z", issue_date: "2026-11-11" },
    ]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("refreshes the published issues with a valid token", async () => {
    const token = createCacheRefreshToken("test-session-secret", new Date());

    const response = await POST(request(`Bearer ${token}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      refreshed: ["published-issues"],
      warm: ["/", "/archive", "/issue/ai-recap-2026-11-12"],
    });
    expect(cache.refreshPublishedIssues).toHaveBeenCalledTimes(1);
  });

  it("still refreshes and returns the list pages to warm when the newest issue cannot be read", async () => {
    repository.fetchPublishedNewsletterEntries.mockRejectedValue(new Error("database down"));
    const token = createCacheRefreshToken("test-session-secret", new Date());

    const response = await POST(request(`Bearer ${token}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ refreshed: ["published-issues"], warm: ["/", "/archive"] });
    expect(cache.refreshPublishedIssues).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no token", undefined],
    ["a malformed token", "Bearer nope"],
    ["a token signed with another secret", `Bearer ${createCacheRefreshToken("another-secret", new Date())}`],
    ["the raw secret", "Bearer test-session-secret"],
  ])("rejects %s", async (_name, authorization) => {
    const response = await POST(request(authorization));

    expect(response.status).toBe(401);
    expect(cache.refreshPublishedIssues).not.toHaveBeenCalled();
  });

  it("answers 503 and refreshes nothing when the secret is not configured", async () => {
    const token = createCacheRefreshToken("test-session-secret", new Date());
    vi.stubEnv("SESSION_SECRET", "");

    const response = await POST(request(`Bearer ${token}`));

    expect(response.status).toBe(503);
    expect(cache.refreshPublishedIssues).not.toHaveBeenCalled();
  });
});
