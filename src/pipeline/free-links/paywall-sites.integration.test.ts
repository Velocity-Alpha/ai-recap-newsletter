// Opt-in: runs against a real database and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/free-links/paywall-sites.integration.test.ts
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { learnedSites, recordPaywalledSite } from "@/src/pipeline/free-links/paywall-sites";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.PIPELINE_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the paywall sites integration test against production.");
}

describe.skipIf(!enabled)("paywall sites on a real database", () => {
  const site = `it-${randomUUID()}.example`;

  afterAll(async () => {
    await prisma.paywallSite.deleteMany({ where: { site } });
  });

  it("keeps the story ids distinct for calls at the same time", async () => {
    await Promise.all([recordPaywalledSite(site, 1), recordPaywalledSite(site, 1), recordPaywalledSite(site, 1)]);

    expect((await prisma.paywallSite.findUnique({ where: { site } }))?.storyIds).toEqual([1]);
    expect(await learnedSites()).not.toContain(site);
  });

  it("learns the site from the second story", async () => {
    await recordPaywalledSite(site, 2);

    expect((await prisma.paywallSite.findUnique({ where: { site } }))?.storyIds).toEqual([1, 2]);
    expect(await learnedSites()).toContain(site);
  });

  it("never learns the site again once it is ignored", async () => {
    await prisma.paywallSite.update({ where: { site }, data: { ignored: true } });
    await recordPaywalledSite(site, 3);

    expect(await learnedSites()).not.toContain(site);
  });
});
