import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ paywallSite: { findMany: vi.fn(), updateMany: vi.fn() } }));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import { ignorePaywallSite, readPaywallSites } from "@/src/features/admin/paywall-sites";

const UPDATED = new Date("2026-11-11T14:00:00Z");

describe("readPaywallSites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists every paywall_sites row by name, with its story count and whether it is learned", async () => {
    prismaMock.paywallSite.findMany.mockResolvedValueOnce([
      { site: "ignored.example", storyIds: [1, 2, 3], ignored: true, updatedAt: UPDATED },
      { site: "learned.example", storyIds: [4, 5], ignored: false, updatedAt: UPDATED },
      { site: "once.example", storyIds: [6], ignored: false, updatedAt: UPDATED },
    ]);

    const sites = await readPaywallSites();

    expect(prismaMock.paywallSite.findMany).toHaveBeenCalledWith({ orderBy: { site: "asc" } });
    expect(sites).toEqual([
      { site: "ignored.example", stories: 3, ignored: true, learned: false, updatedAt: UPDATED },
      { site: "learned.example", stories: 2, ignored: false, learned: true, updatedAt: UPDATED },
      { site: "once.example", stories: 1, ignored: false, learned: false, updatedAt: UPDATED },
    ]);
  });
});

describe("ignorePaywallSite", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets ignored on the site's row and says that it found the row", async () => {
    prismaMock.paywallSite.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(ignorePaywallSite("learned.example")).resolves.toBe(true);
    expect(prismaMock.paywallSite.updateMany).toHaveBeenCalledWith({ where: { site: "learned.example" }, data: { ignored: true } });
  });

  it("says so when the site has no row", async () => {
    prismaMock.paywallSite.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(ignorePaywallSite("missing.example")).resolves.toBe(false);
  });
});
