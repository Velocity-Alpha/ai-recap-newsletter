import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});

import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import { applyStoryChanges } from "@/src/pipeline/draft/story-changes";

const DATE = "2027-01-04";

function story(id: number, data: Record<string, unknown> = {}) {
  return fakeDb.client.story.create({
    data: { id, url: `https://example.test/${id}`, note: null, excludeFromCandidates: false, queuedForPublicationDate: null, ...data },
  });
}

function row(id: number) {
  return fakeDb.state.stories.rows.find((candidate) => Number(candidate.id) === id);
}

const OUTLINE: ApprovalOutline = {
  date: DATE,
  sections: [
    { key: "headlines", storyIds: [1, 2] },
    { key: "tools", storyIds: [3] },
  ],
  leadStoryId: 1,
  stories: [
    { id: 1, section: "headlines", url: "https://example.test/1-edited", note: "Lead with the price." },
    { id: 2, section: "headlines", url: "https://example.test/2", note: "" },
    { id: 3, section: "tools", url: null, note: "" },
    { id: 4, section: "tools", url: "https://example.test/4", note: "" },
  ],
  excluded: [{ id: 4, section: "tools", reason: "off topic" }],
};

beforeEach(async () => {
  fakeDb.reset();
  for (const id of [1, 2, 3, 4, 5]) await story(id);
});

describe("applyStoryChanges", () => {
  it("excludes the excluded stories and queues the approved ones for the date", async () => {
    const changes = await applyStoryChanges(OUTLINE);

    expect(row(4)).toMatchObject({ excludeFromCandidates: true, queuedForPublicationDate: null });
    for (const id of [1, 2, 3]) {
      expect(row(id)).toMatchObject({ excludeFromCandidates: false, queuedForPublicationDate: new Date(`${DATE}T00:00:00.000Z`) });
    }
    expect(row(5)).toMatchObject({ excludeFromCandidates: false, queuedForPublicationDate: null });
    expect(changes).toMatchObject({ excluded: 1, queued: 3 });
  });

  it("saves the board's link and note edits, and only what changed", async () => {
    const changes = await applyStoryChanges(OUTLINE);

    expect(row(1)).toMatchObject({ url: "https://example.test/1-edited", note: "Lead with the price." });
    expect(row(2)).toMatchObject({ url: "https://example.test/2", note: null });
    expect(changes.edited).toBe(1);
  });

  it("never clears a saved note or link with an empty one", async () => {
    await fakeDb.client.story.update({ where: { id: 2 }, data: { note: "Saved earlier." } });

    await applyStoryChanges(OUTLINE);

    expect(row(2)).toMatchObject({ note: "Saved earlier." });
    expect(row(3)).toMatchObject({ url: "https://example.test/3" });
  });

  it("writes nothing when one change fails", async () => {
    const real = fakeDb.client.story.updateMany;
    let calls = 0;
    const spy = vi.spyOn(fakeDb.client.story, "updateMany").mockImplementation(async (args) => {
      calls += 1;
      if (calls === 2) throw new Error("connection lost");
      return real(args);
    });

    await expect(applyStoryChanges(OUTLINE)).rejects.toThrow("connection lost");
    spy.mockRestore();

    expect(row(4)).toMatchObject({ excludeFromCandidates: false });
    expect(row(1)).toMatchObject({ queuedForPublicationDate: null, url: "https://example.test/1" });
  });
});
