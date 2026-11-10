import { beforeEach, describe, expect, it, vi } from "vitest";

const storyFindMany = vi.hoisted(() => vi.fn());
const issueFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/prisma", () => ({
  prisma: {
    story: { findMany: storyFindMany },
    issue: { findMany: issueFindMany },
  },
}));

import { findUnsentDrafts } from "@/src/features/newsletter/unsent-drafts";

function queued(id: number, date: string) {
  return { id, queuedForPublicationDate: new Date(`${date}T00:00:00.000Z`) };
}

describe("findUnsentDrafts", () => {
  beforeEach(() => {
    storyFindMany.mockReset();
    issueFindMany.mockReset();
    issueFindMany.mockResolvedValue([]);
  });

  it("groups unused stories approved for earlier dates in the candidate window", async () => {
    storyFindMany.mockResolvedValue([
      queued(11, "2026-10-22"),
      queued(12, "2026-10-22"),
      queued(9, "2026-10-21"),
    ]);

    const drafts = await findUnsentDrafts("2026-10-23");

    expect(drafts).toEqual([
      { date: "2026-10-22", storyIds: [11, 12] },
      { date: "2026-10-21", storyIds: [9] },
    ]);
    expect(storyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          queuedForPublicationDate: {
            gte: new Date("2026-10-20T00:00:00.000Z"),
            lt: new Date("2026-10-23T00:00:00.000Z"),
          },
          usedInPublicationDate: null,
        },
      })
    );
  });

  it("skips dates that already have a published issue", async () => {
    storyFindMany.mockResolvedValue([queued(11, "2026-10-22"), queued(9, "2026-10-21")]);
    issueFindMany.mockResolvedValue([{ issueDate: new Date("2026-10-21T00:00:00.000Z") }]);

    const drafts = await findUnsentDrafts("2026-10-23");

    expect(drafts).toEqual([{ date: "2026-10-22", storyIds: [11] }]);
    expect(issueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "published",
          issueDate: {
            in: [new Date("2026-10-22T00:00:00.000Z"), new Date("2026-10-21T00:00:00.000Z")],
          },
        },
      })
    );
  });

  it("does not look up issues when nothing is waiting", async () => {
    storyFindMany.mockResolvedValue([]);

    await expect(findUnsentDrafts("2026-10-23")).resolves.toEqual([]);
    expect(issueFindMany).not.toHaveBeenCalled();
  });
});
