// Opt-in: runs against a real database and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/draft/story-changes.integration.test.ts
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
// It writes only its own synthetic story rows.
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import { applyStoryChanges } from "@/src/pipeline/draft/story-changes";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.PIPELINE_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the story changes integration test against production.");
}

describe.skipIf(!enabled)("story changes on a real database", () => {
  const tag = `it-${randomUUID()}`;
  // A far-future date no real issue uses, different on each run.
  const date = `2099-${String(randomInt(1, 13)).padStart(2, "0")}-${String(randomInt(1, 29)).padStart(2, "0")}`;

  async function makeStory(name: string): Promise<number> {
    const row = await prisma.story.create({
      data: { guid: `${tag}-${name}`, headline: `Synthetic ${name}`, url: `https://example.test/${name}` },
      select: { id: true },
    });
    return row.id;
  }

  /** The stored columns, with the date as Postgres holds it, so a time-zone shift on write would show. */
  async function readStories(ids: number[]) {
    const rows = await prisma.$queryRaw<
      { id: number; queued: string | null; excluded: boolean | null; url: string | null; note: string | null }[]
    >`SELECT id, queued_for_publication_date::text AS queued, exclude_from_candidates AS excluded, url, note
      FROM stories WHERE guid LIKE ${`${tag}-%`}`;
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    return ids.map((id) => byId.get(id));
  }

  function outlineFor(ids: { lead: number; second: number; dropped: number }, note: string): ApprovalOutline {
    return {
      date,
      sections: [{ key: "top_stories", storyIds: [ids.lead, ids.second] }],
      leadStoryId: ids.lead,
      stories: [
        { id: ids.lead, section: "top_stories", url: `https://example.test/${tag}/edited`, note },
        { id: ids.second, section: "top_stories", url: null, note: "" },
      ],
      excluded: [{ id: ids.dropped, section: "top_stories", reason: "duplicate" }],
    };
  }

  let ids: { lead: number; second: number; dropped: number };

  beforeAll(async () => {
    ids = { lead: await makeStory("lead"), second: await makeStory("second"), dropped: await makeStory("dropped") };
  });

  afterAll(async () => {
    await prisma.story.deleteMany({ where: { guid: { startsWith: tag } } });
  });

  it("rolls back every write when one fails part way", async () => {
    // Postgres refuses a NUL byte in text, so the note edit, the last write, fails after the exclude and queue
    // writes have run in the same transaction.
    await expect(applyStoryChanges(outlineFor(ids, "Bad \u0000 note"))).rejects.toThrow();

    const [lead, second, dropped] = await readStories([ids.lead, ids.second, ids.dropped]);
    expect(lead).toMatchObject({ queued: null, url: "https://example.test/lead", note: null });
    expect(second).toMatchObject({ queued: null });
    expect(dropped).toMatchObject({ excluded: false });
  });

  it("queues the approved stories for the outline's calendar date, excludes, and saves the edits", async () => {
    const changes = await applyStoryChanges(outlineFor(ids, "Synthetic owner note."));

    expect(changes).toEqual({ excluded: 1, queued: 2, edited: 1 });
    const [lead, second, dropped] = await readStories([ids.lead, ids.second, ids.dropped]);
    expect(lead).toMatchObject({
      queued: date,
      url: `https://example.test/${tag}/edited`,
      note: "Synthetic owner note.",
    });
    expect(second).toMatchObject({ queued: date, url: "https://example.test/second", note: null });
    expect(dropped).toMatchObject({ queued: null, excluded: true });
  });
});
