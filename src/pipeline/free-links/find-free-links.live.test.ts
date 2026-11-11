// Opt-in: one real search for free links, with the real web search (about 4 cents) and the real article reader,
// on a real database. It saves the story's free links there and marks the story as searched.
//   FREE_LINKS_LIVE=1 OPENAI_API_KEY=... DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/free-links/find-free-links.live.test.ts
// FREE_LINKS_STORY_ID names the story. Without it, the newest story with a paywalled link that was not searched.
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
import { describe, expect, it, vi } from "vitest";

import { findFreeLinks } from "@/src/pipeline/free-links/find-free-links";
import { readFreeLinks } from "@/src/pipeline/free-links/read-free-links";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.FREE_LINKS_LIVE === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the live search for free links against production.");
}

describe.skipIf(!enabled)("the search for free links, live", () => {
  it("finds and saves the free links of one paywalled story, and searches it only once", async () => {
    const named = Number(process.env.FREE_LINKS_STORY_ID);
    const story = await prisma.story.findFirst({
      where: { paywallDetected: "yes", freeLinksCheckedAt: null, url: { not: null }, ...(named ? { id: named } : {}) },
      orderBy: { id: "desc" },
      select: { id: true, headline: true, url: true },
    });
    expect(story, "a story with a paywalled link that was not searched").not.toBeNull();
    const errors: string[] = [];

    const started = Date.now();
    const run = await findFreeLinks([story!.id], { log: (message) => errors.push(message) });
    const seconds = Math.round((Date.now() - started) / 1000);

    const saved = (await readFreeLinks([story!.id]))[story!.id];
    console.log(JSON.stringify({ story, run, seconds, errors, saved }, null, 2));
    expect(run).toMatchObject({ stories: 1, failed: 0 });
    expect(saved.done).toBe(true);
    expect(saved.links).toHaveLength(run.links);
    for (const link of saved.links) expect(link.words).toBeGreaterThanOrEqual(300);

    const search = vi.fn(async () => []);
    const again = await findFreeLinks([story!.id], { search });
    expect(again.stories).toBe(0);
    expect(search).not.toHaveBeenCalled();
  }, 300_000);
});
