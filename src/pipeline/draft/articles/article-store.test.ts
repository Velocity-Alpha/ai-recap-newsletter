import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ storyArticle: { findMany: vi.fn(), upsert: vi.fn() } }));
vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import { prismaArticleStore } from "@/src/pipeline/draft/articles/article-store";
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

    expect(prismaMock.storyArticle.findMany).toHaveBeenCalledWith({ where: { storyId: { in: [501, 502] }, status: "read" } });
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
});
