import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});

import type { PrismaClient } from "@/src/generated/prisma";
import { toIssueContentJson } from "@/src/pipeline/draft/content";
import { SAMPLE_CONTENT } from "@/src/pipeline/draft/draft.fixture";
import { emailImageUrl } from "@/src/pipeline/draft/email-html";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";
import type { PublishEventInput } from "@/src/pipeline/publish/detect-publish";
import { createPrismaPublishStore } from "@/src/pipeline/publish/publish-store";
import type { PublishedIssueContent } from "@/src/pipeline/publish/sent-email-parser";

const DATE = "2027-01-04";
const SENT_AT = new Date("2027-01-04T15:30:00.000Z");
const IMAGE_URL = "https://assets.example.test/newsletter/2027-01-04-v2.jpg";

const EVENT: PublishEventInput = {
  mode: "native",
  outcome: "published",
  gmailMessageId: "m1",
  receivedAt: SENT_AT,
  issueId: 0,
  subject: "Subject",
  title: "Title From The Email",
  storyIds: [],
  contentJson: null,
  problems: [],
  draftId: null,
};

const store = () => createPrismaPublishStore(fakeDb.client as unknown as PrismaClient);

async function issueRow(): Promise<number> {
  const row = await fakeDb.client.issue.create({ data: { title: "Newest Draft Title", issueDate: new Date(`${DATE}T00:00:00.000Z`), html: "<html>v3</html>" } });
  return Number((row as { id: bigint }).id);
}

async function draftRow(issueId: number, data: Record<string, unknown> = {}): Promise<number> {
  const row = await fakeDb.client.issueDraft.create({
    data: {
      issueId: BigInt(issueId),
      version: 2,
      outlineId: 1n,
      status: "ready",
      content: SAMPLE_CONTENT,
      html: "<html>v2, the one that was sent</html>",
      featuredImageUrl: IMAGE_URL,
      scenePrompt: "A pretend lab at dawn.",
      ...data,
    },
  });
  return Number((row as { id: bigint }).id);
}

function emailContent(issueId: number): PublishedIssueContent {
  return { issue_id: issueId, title: "Title From The Email" } as unknown as PublishedIssueContent;
}

beforeEach(() => fakeDb.reset());

describe("publish store", () => {
  it("names draft_id in the insert only when the email carried one", async () => {
    await store().recordEvent({ ...EVENT, draftId: 41 });
    await store().recordEvent({ ...EVENT, gmailMessageId: "m2" });

    const [withDraft, withoutDraft] = fakeDb.client.publishEvent.createManyCalls.map((call) => call[0]);
    expect(withDraft.draftId).toBe(BigInt(41));
    // A database without the issue_drafts migration has no draft_id column, so an n8n email must not name it.
    expect(withoutDraft).not.toHaveProperty("draftId");
  });

  it("publishes an n8n email as before: the email's content and title, and no draft lookup", async () => {
    const issueId = await issueRow();
    const findDraft = vi.spyOn(fakeDb.client.issueDraft, "findUnique");

    const outcome = await store().publish({ issueId, content: emailContent(issueId), storyIds: [], publishedAt: SENT_AT, event: { ...EVENT, issueId } });

    expect(outcome).toBe("published");
    expect(findDraft).not.toHaveBeenCalled();
    expect(fakeDb.state.issues.rows[0]).toMatchObject({
      publishedAt: SENT_AT,
      title: "Title From The Email",
      contentJson: emailContent(issueId),
      html: "<html>v3</html>",
    });
    expect(fakeDb.client.publishEvent.createManyCalls[0][0]).not.toHaveProperty("draftId");
  });

  it("copies the sent draft onto the issue, so the archive shows the version that went out", async () => {
    const issueId = await issueRow();
    const draftId = await draftRow(issueId);

    await store().publish({ issueId, content: emailContent(issueId), storyIds: [], publishedAt: SENT_AT, event: { ...EVENT, issueId, draftId } });

    expect(fakeDb.state.issues.rows[0]).toMatchObject({
      publishedAt: SENT_AT,
      title: SAMPLE_CONTENT.title,
      html: "<html>v2, the one that was sent</html>",
      excerpt: SAMPLE_CONTENT.excerpt,
      featureImageUrl: IMAGE_URL,
      promptFeaturedImage: "A pretend lab at dawn.",
      contentJson: toIssueContentJson(SAMPLE_CONTENT, { issueId, issueDate: DATE, featuredImageUrl: emailImageUrl(IMAGE_URL) }),
    });
    expect(fakeDb.state.publishEvents.rows[0]).toMatchObject({ outcome: "published", draftId: BigInt(draftId) });
  });

  it("publishes as before when the draft id is another issue's or the draft has no email", async () => {
    const issueId = await issueRow();
    const otherIssue = await issueRow();
    const othersDraft = await draftRow(otherIssue);
    const unfinished = await draftRow(issueId, { version: 3, html: null });

    await store().publish({ issueId, content: emailContent(issueId), storyIds: [], publishedAt: SENT_AT, event: { ...EVENT, issueId, draftId: othersDraft } });
    expect(fakeDb.state.issues.rows[0]).toMatchObject({ title: "Title From The Email", html: "<html>v3</html>" });

    await store().publish({
      issueId: otherIssue,
      content: emailContent(otherIssue),
      storyIds: [],
      publishedAt: SENT_AT,
      event: { ...EVENT, gmailMessageId: "m2", issueId: otherIssue, draftId: unfinished },
    });
    expect(fakeDb.state.issues.rows[1]).toMatchObject({ title: "Title From The Email", html: "<html>v3</html>" });
  });
});
