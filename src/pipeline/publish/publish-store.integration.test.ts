// Opt-in: runs against a real database and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/publish/publish-store.integration.test.ts
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PublishEventInput } from "@/src/pipeline/publish/detect-publish";
import { createPrismaPublishStore } from "@/src/pipeline/publish/publish-store";
import { parseSentEmail } from "@/src/pipeline/publish/sent-email-parser";
import { PLACEHOLDER_ISSUE, renderIssueEmail } from "@/src/pipeline/publish/sent-email.fixture";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.PIPELINE_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the publish store integration test against production.");
}

describe.skipIf(!enabled)("publish store on a real database", () => {
  const tag = `it-${randomUUID()}`;
  const store = createPrismaPublishStore();
  let issueId = 0;
  let storyIds: number[] = [];

  beforeAll(async () => {
    const issue = await prisma.issue.create({ data: { title: `${tag} draft` }, select: { id: true } });
    issueId = Number(issue.id);
    const stories = await Promise.all(
      [1, 2].map((n) => prisma.story.create({ data: { guid: `${tag}-${n}`, headline: `${tag} ${n}` } })),
    );
    storyIds = stories.map((story) => story.id);
  });

  afterAll(async () => {
    await prisma.publishEvent.deleteMany({ where: { issueId: BigInt(issueId) } });
    await prisma.story.deleteMany({ where: { id: { in: storyIds } } });
    await prisma.issue.deleteMany({ where: { id: BigInt(issueId) } });
  });

  function event(gmailMessageId: string): PublishEventInput {
    return {
      mode: "native",
      outcome: "published",
      gmailMessageId: `${tag}-${gmailMessageId}`,
      receivedAt: new Date("2026-11-03T23:30:00.000Z"),
      issueId,
      subject: "Subject",
      title: "Placeholder Title For Tests",
      storyIds,
      contentJson: null,
      problems: [],
    };
  }

  it("publishes once, marks the stories used on the UTC send date, and records both copies", async () => {
    const content = { ...parseSentEmail(renderIssueEmail(PLACEHOLDER_ISSUE))!.content, issue_id: issueId };
    const publishedAt = new Date("2026-11-03T23:30:00.000Z");

    const first = await store.publish({ issueId, content, storyIds, publishedAt, event: event("a") });
    const second = await store.publish({
      issueId,
      content: { ...content, title: "Changed" },
      storyIds,
      publishedAt: new Date("2026-11-04T10:00:00.000Z"),
      event: event("b"),
    });

    expect([first, second]).toEqual(["published", "already_published"]);
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: BigInt(issueId) } });
    expect(issue.publishedAt?.toISOString()).toBe("2026-11-03T23:30:00.000Z");
    expect(issue.title).toBe("Placeholder Title For Tests");
    expect((issue.contentJson as { issue_id: number }).issue_id).toBe(issueId);
    const stories = await prisma.story.findMany({ where: { id: { in: storyIds } } });
    expect(stories.map((story) => story.usedInPublicationDate?.toISOString().slice(0, 10))).toEqual([
      "2026-11-03",
      "2026-11-03",
    ]);
    const events = await prisma.publishEvent.findMany({
      where: { issueId: BigInt(issueId) },
      orderBy: { id: "asc" },
    });
    expect(events.map((row) => row.outcome)).toEqual(["published", "already_published"]);
  });

  it("records a message once per mode and reports which messages it has seen", async () => {
    await store.recordEvent({ ...event("c"), mode: "shadow", outcome: "would_publish" });
    await store.recordEvent({ ...event("c"), mode: "shadow", outcome: "would_publish" });

    const seen = await store.knownMessageIds("shadow", [`${tag}-c`, `${tag}-missing`]);

    expect([...seen]).toEqual([`${tag}-c`]);
    expect(await prisma.publishEvent.count({ where: { gmailMessageId: `${tag}-c` } })).toBe(1);
  });

  it("rejects an outcome outside the allowed values", async () => {
    await expect(
      prisma.publishEvent.create({ data: { mode: "native", outcome: "sent", issueId: BigInt(issueId) } }),
    ).rejects.toThrow();
  });
});
