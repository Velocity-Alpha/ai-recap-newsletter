import { beforeEach, describe, expect, it, vi } from "vitest";

type SiteRow = { site: string; storyIds: number[]; ignored: boolean };

/** An in-memory `paywall_sites` table with the three calls the store makes. */
const db = vi.hoisted(() => {
  const rows: SiteRow[] = [];
  const paywallSite = {
    createMany: async ({ data, skipDuplicates }: { data: { site: string }[]; skipDuplicates: boolean }) => {
      for (const { site } of data) {
        if (rows.some((row) => row.site === site)) {
          if (!skipDuplicates) throw new Error(`Unique constraint failed on (site): ${site}`);
          continue;
        }
        rows.push({ site, storyIds: [], ignored: false });
      }
    },
    updateMany: async (args: { where: { site: string; NOT: { storyIds: { has: number } } }; data: { storyIds: { push: number } } }) => {
      for (const row of rows) {
        if (row.site === args.where.site && !row.storyIds.includes(args.where.NOT.storyIds.has)) row.storyIds.push(args.data.storyIds.push);
      }
    },
    findMany: async ({ where }: { where: { ignored: boolean } }) =>
      rows.filter((row) => row.ignored === where.ignored).sort((a, b) => a.site.localeCompare(b.site)),
  };
  return { rows, paywallSite };
});

vi.mock("@/src/server/prisma", () => ({ prisma: { paywallSite: db.paywallSite } }));

import { learnedSites, recordPaywalledSite } from "@/src/pipeline/free-links/paywall-sites";

beforeEach(() => {
  db.rows.length = 0;
});

describe("learned paywalled sites", () => {
  it("learns a site when two different stories were paywalled there", async () => {
    await recordPaywalledSite("paywalled.example", 1);
    expect(await learnedSites()).toEqual([]);

    await recordPaywalledSite("paywalled.example", 2);
    expect(await learnedSites()).toEqual(["paywalled.example"]);
  });

  it("does not learn a site from the same story twice", async () => {
    await recordPaywalledSite("paywalled.example", 1);
    await recordPaywalledSite("paywalled.example", 1);

    expect(db.rows).toEqual([{ site: "paywalled.example", storyIds: [1], ignored: false }]);
    expect(await learnedSites()).toEqual([]);
  });

  it("never learns an ignored site, also when more stories are paywalled there", async () => {
    await recordPaywalledSite("ignored.example", 1);
    await recordPaywalledSite("ignored.example", 2);
    db.rows[0].ignored = true;
    await recordPaywalledSite("ignored.example", 3);

    expect(db.rows[0].storyIds).toEqual([1, 2, 3]);
    expect(await learnedSites()).toEqual([]);
  });

  it("lists the learned sites by name", async () => {
    for (const site of ["b.example", "a.example"]) {
      await recordPaywalledSite(site, 1);
      await recordPaywalledSite(site, 2);
    }
    await recordPaywalledSite("once.example", 1);

    expect(await learnedSites()).toEqual(["a.example", "b.example"]);
  });
});
