import { beforeEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({
  getCachedTickerFeed: vi.fn(),
}));

vi.mock("@/src/features/newsletter/server", () => serverFns);

import { GET } from "@/app/api/ticker/route";

describe("GET /api/ticker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ticker data", async () => {
    serverFns.getCachedTickerFeed.mockResolvedValue({
      data: [{ headline: "Story", category: "Product" }],
      stats: { stories: 1, tools: 0, papers: 0 },
      count: 1,
    });

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(json.success).toBe(true);
    expect(json.count).toBe(1);
  });

  it("returns 500 when the ticker helper fails", async () => {
    serverFns.getCachedTickerFeed.mockRejectedValue(new Error("boom"));

    const response = await GET();

    expect(response.status).toBe(500);
  });
});
