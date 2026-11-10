import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});

import { issueState } from "@/src/pipeline/distribution/issue-state";
import { readDateIssueFacts } from "@/src/pipeline/distribution/issue-state-store";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";

const DATE = "2027-01-04";
const DAY = new Date(`${DATE}T00:00:00.000Z`);
const EDITED = new Date("2027-01-04T15:10:00.000Z");
const STAGED_AT = new Date("2027-01-04T15:00:00.000Z");

async function seedIssue(data: Record<string, unknown> = {}): Promise<bigint> {
  const issue = (await fakeDb.client.issue.create({ data: { title: "t", issueDate: DAY, ...data } })) as { id: bigint };
  return issue.id;
}

async function seedDraft(issueId: bigint, data: Record<string, unknown> = {}): Promise<bigint> {
  const draft = (await fakeDb.client.issueDraft.create({
    data: {
      issueId,
      version: 1,
      outlineId: 1n,
      status: "ready",
      content: { title: "Pretend Lab Plans A Week" },
      featuredImageUrl: "https://assets.example.test/a.jpg",
      editedAt: null,
      ...data,
    },
  })) as { id: bigint };
  return draft.id;
}

function seedStaged(issueId: bigint, draftId: bigint, data: Record<string, unknown> = {}) {
  return fakeDb.client.stagedVersion.create({
    data: {
      issueId,
      draftId,
      version: 1,
      status: "staged",
      title: "Pretend Lab Plans A Week",
      featuredImageUrl: "https://assets.example.test/a.jpg",
      service: "pretend_mail",
      serviceUrl: "https://preview.example.test/v1",
      stagedAt: STAGED_AT,
      ...data,
    },
  });
}

beforeEach(() => fakeDb.reset());

describe("readDateIssueFacts", () => {
  it("gives no draft and nothing staged for a date with no issue", async () => {
    const facts = await readDateIssueFacts(DATE);

    expect(facts).toEqual({ issueId: null, published: false, newestDraft: null, newestStaged: null, stagedVersions: [] });
    expect(issueState(facts)).toEqual({ kind: "no_outline" });
  });

  it("gives the newest draft row with its title, image and edit time", async () => {
    const issueId = await seedIssue();
    await seedDraft(issueId);
    const newest = await seedDraft(issueId, { version: 2, status: "running", content: null, featuredImageUrl: null });

    const facts = await readDateIssueFacts(DATE);

    expect(facts.newestDraft).toEqual({ id: Number(newest), status: "running", title: null, featuredImageUrl: null, editedAt: null });
    expect(issueState(facts)).toEqual({ kind: "drafting" });
  });

  it("gives the staged versions, newest first, without the ones still staging", async () => {
    const issueId = await seedIssue();
    const draftId = await seedDraft(issueId, { editedAt: EDITED });
    await seedStaged(issueId, draftId);
    await seedStaged(issueId, draftId, { version: 2, serviceUrl: null });
    await seedStaged(issueId, draftId, { version: 3, status: "staging", stagedAt: null });

    const facts = await readDateIssueFacts(DATE);

    expect(facts.stagedVersions.map((row) => row.version)).toEqual([2, 1]);
    expect(facts.newestStaged).toEqual({
      id: expect.any(Number),
      version: 2,
      draftId: Number(draftId),
      title: "Pretend Lab Plans A Week",
      featuredImageUrl: "https://assets.example.test/a.jpg",
      stagedAt: STAGED_AT,
      service: "pretend_mail",
      serviceUrl: null,
    });
    expect(facts.newestDraft?.editedAt).toEqual(EDITED);
    expect(issueState(facts)).toEqual({ kind: "staged", version: 2, changedSinceStaged: false });
  });

  it("says the draft changed when its title is not the staged one", async () => {
    const issueId = await seedIssue();
    const draftId = await seedDraft(issueId, { content: { title: "Pretend Lab Plans A Month" } });
    await seedStaged(issueId, draftId);

    expect(issueState(await readDateIssueFacts(DATE))).toEqual({ kind: "staged", version: 1, changedSinceStaged: true });
  });

  it("says published when the date's issue is published", async () => {
    const issueId = await seedIssue({ publishedAt: STAGED_AT });
    await seedDraft(issueId);

    const facts = await readDateIssueFacts(DATE);

    expect(facts.published).toBe(true);
    expect(facts.issueId).toBe(Number(issueId));
  });

  it("reads nothing from another date", async () => {
    const issueId = await seedIssue({ issueDate: new Date("2027-01-05T00:00:00.000Z") });
    await seedDraft(issueId);

    expect((await readDateIssueFacts(DATE)).newestDraft).toBeNull();
  });
});
