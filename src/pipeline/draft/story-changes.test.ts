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
    data: {
      id,
      url: `https://example.test/${id}`,
      note: null,
      excludeFromCandidates: false,
      queuedForPublicationDate: null,
      originalUrl: null,
      paywallDetected: "yes",
      error: "",
      ...data,
    },
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
  excluded: [{ id: 4, section: "tools", reason: "off topic", reasonCode: "" }],
};

/** One story with a new link, as the board sends it. */
function outlineWithLink(url: string): ApprovalOutline {
  return { ...OUTLINE, stories: [{ id: 1, section: "headlines", url, note: "" }], excluded: [] };
}

/** The pages the paywall check opens: free unless the test gives another answer. No test opens a real page. */
function fakePages(answer: () => Response = () => new Response('<meta property="article:content_tier" content="free">')) {
  return { fetch: vi.fn<typeof fetch>(async () => answer()), learnedSites: vi.fn(async () => ["learned.example"]) };
}

beforeEach(async () => {
  fakeDb.reset();
  for (const id of [1, 2, 3, 4, 5]) await story(id);
});

describe("applyStoryChanges", () => {
  it("excludes the excluded stories and queues the approved ones for the date", async () => {
    const changes = await applyStoryChanges(OUTLINE, fakePages());

    // excludedOn: the repeat check labels later look-alikes with this day (#90).
    expect(row(4)).toMatchObject({ excludeFromCandidates: true, excludedOn: new Date(`${DATE}T00:00:00.000Z`), queuedForPublicationDate: null });
    for (const id of [1, 2, 3]) {
      expect(row(id)).toMatchObject({ excludeFromCandidates: false, queuedForPublicationDate: new Date(`${DATE}T00:00:00.000Z`) });
    }
    expect(row(5)).toMatchObject({ excludeFromCandidates: false, queuedForPublicationDate: null });
    expect(changes).toMatchObject({ excluded: 1, queued: 3 });
  });

  it("saves the board's link and note edits, and only what changed", async () => {
    const changes = await applyStoryChanges(OUTLINE, fakePages());

    expect(row(1)).toMatchObject({ url: "https://example.test/1-edited", note: "Lead with the price." });
    expect(row(2)).toMatchObject({ url: "https://example.test/2", note: null });
    expect(changes.edited).toBe(1);
  });

  it("never clears a saved note or link with an empty one", async () => {
    await fakeDb.client.story.update({ where: { id: 2 }, data: { note: "Saved earlier." } });

    await applyStoryChanges(OUTLINE, fakePages());

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

    await expect(applyStoryChanges(OUTLINE, fakePages())).rejects.toThrow("connection lost");
    spy.mockRestore();

    expect(row(4)).toMatchObject({ excludeFromCandidates: false });
    expect(row(1)).toMatchObject({ queuedForPublicationDate: null, url: "https://example.test/1" });
  });

  it("keeps the first original link over two commits", async () => {
    await applyStoryChanges(outlineWithLink("https://free.example/first"), fakePages());
    await applyStoryChanges(outlineWithLink("https://free.example/second"), fakePages());

    expect(row(1)).toMatchObject({ url: "https://free.example/second", originalUrl: "https://example.test/1" });
  });

  it("leaves the original link empty for a story whose link did not change", async () => {
    await applyStoryChanges(OUTLINE, fakePages());

    expect(row(2)).toMatchObject({ originalUrl: null, paywallDetected: "yes" });
  });

  it("marks a new link as free, with no check, when it is a free link of the story", async () => {
    await fakeDb.client.storyFreeLink.create({
      data: { storyId: 1, position: 0, url: "https://free.example/a", site: "free.example", words: 800, origin: "search" },
    });
    const deps = fakePages();

    await applyStoryChanges(outlineWithLink("https://free.example/a"), deps);

    expect(row(1)).toMatchObject({ url: "https://free.example/a", paywallDetected: "no", error: "" });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("does not trust a free link of another story", async () => {
    await fakeDb.client.storyFreeLink.create({
      data: { storyId: 2, position: 0, url: "https://free.example/a", site: "free.example", words: 800, origin: "search" },
    });
    const deps = fakePages(() => new Response("Subscribe to continue reading."));

    await applyStoryChanges(outlineWithLink("https://free.example/a"), deps);

    expect(row(1)).toMatchObject({ paywallDetected: "yes" });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it("saves the paywall check's answer for a typed link", async () => {
    await applyStoryChanges(outlineWithLink("https://typed.example/b"), fakePages());

    expect(row(1)).toMatchObject({ url: "https://typed.example/b", paywallDetected: "no", error: "" });
  });

  it("saves the paywall check's error for a typed link whose page cannot be opened", async () => {
    await applyStoryChanges(outlineWithLink("https://typed.example/a"), fakePages(() => new Response("", { status: 403 })));

    expect(row(1)).toMatchObject({ url: "https://typed.example/a", paywallDetected: "error", error: "HTTP 403" });
  });

  it("clears the stored error when a later link is checked with no error", async () => {
    await applyStoryChanges(outlineWithLink("https://typed.example/a"), fakePages(() => new Response("", { status: 403 })));

    await applyStoryChanges(outlineWithLink("https://typed.example/b"), fakePages());

    expect(row(1)).toMatchObject({ paywallDetected: "no", error: "" });
  });

  it("checks a typed link without the learned sites when they cannot be read, and still commits", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deps = { ...fakePages(), learnedSites: vi.fn(async () => Promise.reject(new Error("database is down"))) };

    await applyStoryChanges(outlineWithLink("https://www.learned.example/a"), deps);

    expect(row(1)).toMatchObject({ url: "https://www.learned.example/a", paywallDetected: "no" });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("database is down"));
    logged.mockRestore();
  });

  it("checks a typed link like any link when the free links cannot be read, and still commits", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const findMany = vi.spyOn(fakeDb.client.storyFreeLink, "findMany").mockRejectedValue(new Error("no such table"));
    const deps = fakePages();

    await applyStoryChanges(outlineWithLink("https://typed.example/a"), deps);

    expect(row(1)).toMatchObject({ url: "https://typed.example/a", paywallDetected: "no" });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    findMany.mockRestore();
    logged.mockRestore();
  });

  it("gives each page check a 5 second limit", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await applyStoryChanges(outlineWithLink("https://typed.example/a"), fakePages());

    expect(timeout).toHaveBeenCalledWith(5_000);
    timeout.mockRestore();
  });

  it("marks a typed link on a learned paywalled site as paywalled, without opening its page", async () => {
    const deps = fakePages();

    await applyStoryChanges(outlineWithLink("https://www.learned.example/a"), deps);

    expect(row(1)).toMatchObject({ paywallDetected: "yes", error: "" });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("runs no paywall check when no link changed", async () => {
    const deps = fakePages();

    await applyStoryChanges({ ...OUTLINE, stories: [{ id: 2, section: "headlines", url: "https://example.test/2", note: "A note." }] }, deps);

    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.learnedSites).not.toHaveBeenCalled();
    expect(row(2)).toMatchObject({ note: "A note.", paywallDetected: "yes" });
  });
});
