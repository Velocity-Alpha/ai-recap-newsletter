// Opt-in: runs against a real database and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/publish/publish-store.integration.test.ts
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PublishEventInput } from "@/src/pipeline/publish/detect-publish";
import { createPrismaPublishStore } from "@/src/pipeline/publish/publish-store";
import { parseSentEmail } from "@/src/pipeline/publish/sent-email-parser";
import { PLACEHOLDER_ISSUE, renderIssueEmail, type FixtureIssue } from "@/src/pipeline/publish/sent-email.fixture";
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

  const extraIssueIds: bigint[] = [];
  const outlineIds: bigint[] = [];

  afterAll(async () => {
    const issueIds = [BigInt(issueId), ...extraIssueIds];
    await prisma.issueStory.deleteMany({ where: { issueId: { in: issueIds } } });
    await prisma.publishEvent.deleteMany({ where: { issueId: { in: issueIds } } });
    await prisma.issueDraft.deleteMany({ where: { issueId: { in: issueIds } } });
    await prisma.approvalOutline.deleteMany({ where: { id: { in: outlineIds } } });
    await prisma.story.deleteMany({ where: { id: { in: storyIds } } });
    await prisma.issue.deleteMany({ where: { id: { in: issueIds } } });
  });

  async function draftIssue(): Promise<number> {
    // The slug comes from the title and is unique, so each test issue gets its own title.
    const issue = await prisma.issue.create({ data: { title: `${tag} draft ${extraIssueIds.length + 2}` }, select: { id: true } });
    extraIssueIds.push(issue.id);
    return Number(issue.id);
  }

  /** The sent email of an issue that holds the two test stories: one story in Top Stories, one in Quick Hits. */
  function sentEmail(id: number) {
    const issue: FixtureIssue = {
      ...PLACEHOLDER_ISSUE,
      issueId: id,
      // (title, published_at) is unique on issues, and publish takes the title from the email.
      title: `Placeholder Title ${id}`,
      headlines: [{ story_id: storyIds[0], url: "https://news.example.test/story-a", headline: "Headline A" }],
      research: [],
      tools: [],
      quickHits: [{ story_id: storyIds[1], url: "https://hits.example.test/f", link_text: "Hit F", text: "says F." }],
    };
    return parseSentEmail(renderIssueEmail(issue, { received: true }))!;
  }

  const issueStories = (id: number) =>
    prisma.issueStory.findMany({
      where: { issueId: BigInt(id) },
      orderBy: { storyId: "asc" },
      select: { storyId: true, section: true, position: true, url: true, isLead: true },
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
      draftId: 41,
      versionId: null,
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
    expect(events.map((row) => row.draftId)).toEqual([BigInt(41), BigInt(41)]);
  });

  it("writes one row for each story of the sent email, with the lead of the outline of the draft the email names", async () => {
    const id = await draftIssue();
    const outline = await prisma.approvalOutline.create({
      data: { issueDate: new Date("2026-11-03T00:00:00.000Z"), payload: { leadStoryId: storyIds[1] }, payloadHash: tag },
      select: { id: true },
    });
    outlineIds.push(outline.id);
    const draft = await prisma.issueDraft.create({
      data: { issueId: BigInt(id), version: 1, outlineId: outline.id, status: "ready" },
      select: { id: true },
    });
    const sent = sentEmail(id);
    const publishedAt = new Date("2026-11-03T23:30:00.000Z");
    const named = { ...event("d"), issueId: id, draftId: Number(draft.id) };

    const first = await store.publish({ issueId: id, content: sent.content, storyIds: sent.storyIds, publishedAt, event: named });

    expect(first).toBe("published");
    const rows = [
      { storyId: storyIds[0], section: "headlines", position: 1, url: "https://news.example.test/story-a", isLead: false },
      { storyId: storyIds[1], section: "quick_hits", position: 1, url: "https://hits.example.test/f", isLead: true },
    ].sort((a, b) => a.storyId - b.storyId);
    expect(await issueStories(id)).toEqual(rows);

    // A second copy of the email, changed in between, finds the issue published and writes nothing.
    const again = { ...sent.content, headlines: [], tools: sent.content.quick_hits.map((hit) => ({ ...hit, detail: "" })), quick_hits: [] };
    const second = await store.publish({ issueId: id, content: again, storyIds: sent.storyIds, publishedAt, event: { ...named, gmailMessageId: `${tag}-e` } });

    expect(second).toBe("already_published");
    expect(await issueStories(id)).toEqual(rows);
  });

  it("leaves is_lead null when the sent email names no draft", async () => {
    const id = await draftIssue();
    const sent = sentEmail(id);

    await store.publish({
      issueId: id,
      content: sent.content,
      storyIds: sent.storyIds,
      publishedAt: new Date("2026-11-03T23:30:00.000Z"),
      event: { ...event("f"), issueId: id, draftId: null },
    });

    expect((await issueStories(id)).map((row) => [row.storyId, row.isLead])).toEqual(
      [...storyIds].sort((a, b) => a - b).map((storyId) => [storyId, null]),
    );
  });

  it("rejects a section outside the four story sections", async () => {
    await expect(
      prisma.issueStory.create({ data: { issueId: BigInt(issueId), storyId: storyIds[0], section: "overview", position: 1 } }),
    ).rejects.toThrow();
  });

  it("records a message once per mode and reports which messages it has seen", async () => {
    await store.recordEvent({ ...event("c"), mode: "manual", outcome: "published" });
    await store.recordEvent({ ...event("c"), mode: "manual", outcome: "published" });

    const seen = await store.knownMessageIds("manual", [`${tag}-c`, `${tag}-missing`]);

    expect([...seen]).toEqual([`${tag}-c`]);
    expect(await prisma.publishEvent.count({ where: { gmailMessageId: `${tag}-c` } })).toBe(1);
  });

  it("rejects an outcome outside the allowed values", async () => {
    await expect(
      prisma.publishEvent.create({ data: { mode: "native", outcome: "sent", issueId: BigInt(issueId) } }),
    ).rejects.toThrow();
  });
});
