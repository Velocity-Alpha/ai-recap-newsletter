// Opt-in: runs against a real database and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/repeats/repeats-store.integration.test.ts
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { JudgePairs } from "@/src/pipeline/repeats/decisions";
import { matchStories } from "@/src/pipeline/repeats/match-stories";
import { createPrismaRepeatsStore, findUnmatchedStoryIds } from "@/src/pipeline/repeats/repeats-store";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.PIPELINE_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the repeats store integration test against production.");
}

describe.skipIf(!enabled)("repeats store on a real database", () => {
  const tag = `it-${randomUUID()}`;
  // Far in the future, so no real story is in the pool.
  const days = ["2099-01-01", "2099-01-09", "2099-01-10"];
  let ids: number[] = [];

  beforeAll(async () => {
    const rows = await prisma.$transaction(
      days.map((day, index) =>
        prisma.story.create({
          data: { guid: `${tag}-${index}`, day: new Date(`${day}T00:00:00Z`), headline: `Headline ${index}`, summary: "Same news." },
          select: { id: true },
        }),
      ),
    );
    ids = rows.map((row) => row.id);
  });

  afterAll(async () => {
    await prisma.storyMatch.deleteMany({ where: { OR: [{ newerStoryId: { in: ids } }, { olderStoryId: { in: ids } }] } });
    await prisma.storyEmbedding.deleteMany({ where: { storyId: { in: ids } } });
    await prisma.story.deleteMany({ where: { guid: { startsWith: tag } } });
  });

  it("stores embeddings and matches, sets matched_at, and judges no pair again", async () => {
    const store = createPrismaRepeatsStore();
    // All three point the same way: every pair is near.
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
    const judge = vi.fn<JudgePairs>(async (_newer, olders) => olders.map((older) => ({ olderId: older.id, same: 0.9, news: 0.1 })));

    expect(await findUnmatchedStoryIds("2099-01-01")).toEqual(expect.arrayContaining(ids));
    const first = await matchStories(ids, { store, embed, judge, windowDays: 14 });
    expect(first).toEqual({ embedded: 3, judged: 2, pairs: 3, refused: 0 });

    const matches = await prisma.storyMatch.findMany({ where: { newerStoryId: { in: ids } }, orderBy: [{ newerStoryId: "asc" }, { olderStoryId: "asc" }] });
    expect(matches.map((m) => [m.newerStoryId, m.olderStoryId])).toEqual([
      [ids[1], ids[0]],
      [ids[2], ids[0]],
      [ids[2], ids[1]],
    ]);
    expect(matches[0].similarity).toBeCloseTo(1);
    const embedded = await prisma.storyEmbedding.findMany({ where: { storyId: { in: ids } } });
    expect(embedded.map((row) => row.vector)).toEqual([[1, 0], [1, 0], [1, 0]]);
    expect(await findUnmatchedStoryIds("2099-01-01")).toEqual([]);

    // A second run: the stories are checked. Even when asked again with matched_at cleared, no pair is judged again.
    await prisma.story.updateMany({ where: { id: { in: ids } }, data: { matchedAt: null } });
    judge.mockClear();
    const second = await matchStories(ids, { store, embed, judge, windowDays: 14 });
    expect(second).toEqual({ embedded: 0, judged: 0, pairs: 0, refused: 0 });
    expect(judge).not.toHaveBeenCalled();
  });
});
