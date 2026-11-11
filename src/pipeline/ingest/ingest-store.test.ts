import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  story: { upsert: vi.fn() },
  storySource: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import type { StoryRow } from "@/src/pipeline/ingest/ingest";
import { createPrismaIngestStore } from "@/src/pipeline/ingest/ingest-store";

function row(guid: string, source: string): StoryRow {
  return {
    guid,
    day: "2026-11-10",
    headline: "Headline",
    url: `https://example.org/${guid}`,
    summary: "Summary.",
    category: "Industry",
    source,
    storyDetails: "Detail.",
    importanceScore: 4,
    paywallDetected: "no",
    error: "",
  };
}

describe("ingest store: coverage across sources (#58)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.story.upsert.mockImplementation((args: { where: { guid: string } }) => args.where.guid);
    // The upserted rows come back in order, with their ids.
    prismaMock.$transaction.mockImplementation(async (calls: string[]) =>
      calls.map((guid) => ({ id: Number(guid.replace("g", "")) })),
    );
    prismaMock.storySource.createMany.mockResolvedValue({ count: 2 });
  });

  it("records which newsletter each saved story came from, once per story and source", async () => {
    const store = createPrismaIngestStore();

    await expect(store.upsertStories([row("g11", "tldr"), row("g12", "tldr")])).resolves.toBe(2);

    expect(prismaMock.story.upsert).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true } }));
    expect(prismaMock.storySource.createMany).toHaveBeenCalledWith({
      data: [
        { storyId: 11, source: "tldr" },
        { storyId: 12, source: "tldr" },
      ],
      skipDuplicates: true,
    });
  });

  it("still saves the stories when the sources cannot be recorded", async () => {
    prismaMock.storySource.createMany.mockRejectedValue(new Error('relation "story_sources" does not exist'));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createPrismaIngestStore();

    await expect(store.upsertStories([row("g11", "rundown_ai")])).resolves.toBe(1);
    expect(JSON.parse(String(consoleError.mock.calls[0][0]))).toEqual({
      event: "ingest.story_sources.failed",
      error: 'relation "story_sources" does not exist',
      storyCount: 1,
    });
    consoleError.mockRestore();
  });
});
