import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ storyArticle: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() }, issue: { findMany: vi.fn() } }));
vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import { CLEAR_BATCH, prismaArticleStore } from "@/src/pipeline/draft/articles/article-store";
import { MAX_TEXT_CHARS } from "@/src/pipeline/draft/articles/read-article";
import type { StoryArticleRead } from "@/src/pipeline/draft/articles/read-articles";

const NOW = new Date("2027-01-04T15:00:00.000Z");

function savedRow(storyId: number, url: string, status = "read") {
  return {
    id: BigInt(storyId),
    storyId,
    url,
    status,
    method: "fetch",
    finalUrl: `${url}?final`,
    text: status === "read" ? "Saved pretend text." : null,
    chars: 19,
    error: null,
    attempts: [{ method: "fetch", ms: 40, chars: 19, outcome: "read", httpStatus: 200 }],
    readMs: 45,
    readAt: new Date("2027-01-03T15:00:00.000Z"),
  };
}

beforeEach(() => {
  prismaMock.storyArticle.findMany.mockReset();
  prismaMock.storyArticle.upsert.mockReset().mockResolvedValue({});
  prismaMock.storyArticle.updateMany.mockReset();
  prismaMock.issue.findMany.mockReset();
});

describe("prismaArticleStore.findRead", () => {
  it("returns read copies whose story and link both match", async () => {
    prismaMock.storyArticle.findMany.mockResolvedValue([
      savedRow(501, "https://news.example.com/a"),
      savedRow(502, "https://news.example.com/old-link"),
    ]);

    const found = await prismaArticleStore.findRead([
      { storyId: 501, url: "https://news.example.com/a" },
      { storyId: 502, url: "https://news.example.com/edited-on-the-board" },
    ]);

    expect(prismaMock.storyArticle.findMany).toHaveBeenCalledWith({ where: { storyId: { in: [501, 502] }, status: "read", text: { not: null } } });
    expect(found).toEqual([
      {
        storyId: 501,
        url: "https://news.example.com/a",
        status: "read",
        method: "fetch",
        text: "Saved pretend text.",
        finalUrl: "https://news.example.com/a?final",
        chars: 19,
        ms: 45,
        error: null,
        attempts: [{ method: "fetch", ms: 40, chars: 19, outcome: "read", httpStatus: 200 }],
        readAt: new Date("2027-01-03T15:00:00.000Z"),
      },
    ]);
  });

  it("asks for nothing when there are no stories", async () => {
    await expect(prismaArticleStore.findRead([])).resolves.toEqual([]);
    expect(prismaMock.storyArticle.findMany).not.toHaveBeenCalled();
  });
});

describe("prismaArticleStore.save", () => {
  it("upserts one row per story and link, read or not", async () => {
    const reads: StoryArticleRead[] = [
      {
        storyId: 501,
        url: "https://news.example.com/a",
        status: "read",
        method: "jina",
        text: "Fresh pretend text.",
        finalUrl: "https://news.example.com/a",
        chars: 19,
        ms: 1_200,
        error: null,
        attempts: [{ method: "jina", ms: 1_100, chars: 19, outcome: "read", httpStatus: 200 }],
      },
      {
        storyId: 502,
        url: "https://news.example.com/b",
        status: "blocked",
        method: null,
        text: null,
        finalUrl: null,
        chars: 0,
        ms: 300,
        error: "fetch: HTTP 403.",
        attempts: [{ method: "fetch", ms: 300, chars: 0, outcome: "blocked", httpStatus: 403, error: "HTTP 403." }],
      },
    ];

    await prismaArticleStore.save(reads, NOW);

    expect(prismaMock.storyArticle.upsert).toHaveBeenCalledTimes(2);
    const fields = {
      status: "blocked",
      method: null,
      finalUrl: null,
      text: null,
      chars: 0,
      error: "fetch: HTTP 403.",
      attempts: reads[1].attempts,
      readMs: 300,
      readAt: NOW,
    };
    expect(prismaMock.storyArticle.upsert).toHaveBeenCalledWith({
      where: { storyId_url: { storyId: 502, url: "https://news.example.com/b" } },
      create: { storyId: 502, url: "https://news.example.com/b", ...fields },
      update: fields,
    });
  });

  it("records the drafting issue, and holds the 50,000-character cap whatever it is given", async () => {
    const long: StoryArticleRead = {
      storyId: 503,
      url: "https://news.example.com/c",
      status: "read",
      method: "fetch",
      text: "x".repeat(MAX_TEXT_CHARS + 500),
      finalUrl: "https://news.example.com/c",
      chars: MAX_TEXT_CHARS + 500,
      ms: 900,
      error: null,
      attempts: [],
    };

    await prismaArticleStore.save([long], NOW, { issueId: 301 });

    const { create, update } = prismaMock.storyArticle.upsert.mock.calls[0][0];
    expect(create.text).toHaveLength(MAX_TEXT_CHARS);
    expect(create).toMatchObject({ issueId: BigInt(301), chars: MAX_TEXT_CHARS + 500 });
    expect(update.issueId).toBe(BigInt(301));
  });
});

describe("prismaArticleStore.clearOldText", () => {
  it("clears the text of copies read over 30 days ago, or whose issue was published over 14 days ago, in one bounded batch", async () => {
    prismaMock.issue.findMany.mockResolvedValue([{ id: BigInt(280) }, { id: BigInt(281) }]);
    prismaMock.storyArticle.findMany.mockResolvedValue([{ id: BigInt(7) }, { id: BigInt(9) }]);
    prismaMock.storyArticle.updateMany.mockResolvedValue({ count: 2 });

    await expect(prismaArticleStore.clearOldText(NOW)).resolves.toBe(2);

    const day = 24 * 60 * 60 * 1000;
    const readBefore = new Date(NOW.getTime() - 30 * day);
    expect(prismaMock.issue.findMany).toHaveBeenCalledWith({
      where: { publishedAt: { lt: new Date(NOW.getTime() - 14 * day), gte: readBefore } },
      select: { id: true },
    });
    expect(prismaMock.storyArticle.findMany).toHaveBeenCalledWith({
      where: { text: { not: null }, OR: [{ readAt: { lt: readBefore } }, { issueId: { in: [BigInt(280), BigInt(281)] } }] },
      select: { id: true },
      orderBy: { readAt: "asc" },
      take: CLEAR_BATCH,
    });
    // Only the text goes: status, method, timings and attempts stay for the record.
    expect(prismaMock.storyArticle.updateMany).toHaveBeenCalledWith({ where: { id: { in: [BigInt(7), BigInt(9)] } }, data: { text: null } });
  });

  it("uses only the age rule when no issue is in the window, and writes nothing when no row is due", async () => {
    prismaMock.issue.findMany.mockResolvedValue([]);
    prismaMock.storyArticle.findMany.mockResolvedValue([]);

    await expect(prismaArticleStore.clearOldText(NOW)).resolves.toBe(0);

    expect(prismaMock.storyArticle.findMany.mock.calls[0][0].where.OR).toEqual([{ readAt: { lt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000) } }]);
    expect(prismaMock.storyArticle.updateMany).not.toHaveBeenCalled();
  });
});
