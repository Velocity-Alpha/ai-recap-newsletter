import { beforeEach, describe, expect, it, vi } from "vitest";

const runLog = vi.hoisted(() => ({ started: [] as unknown[] }));

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});
vi.mock("@/src/pipeline/runs", () => ({
  startRun: vi.fn(async (input: unknown) => {
    runLog.started.push(input);
    return BigInt(9);
  }),
  logEvent: vi.fn(async () => {}),
  finishRun: vi.fn(async () => {}),
}));

import { toIssueContentJson } from "@/src/pipeline/draft/content";
import {
  createDraft,
  DraftEditError,
  DraftNotRetryableError,
  editCurrentDraft,
  findDraftToRun,
  getDraftHtml,
  getDraftStatus,
  isStuckDraft,
  IssuePublishedError,
  readCurrentDraft,
  retryDraft,
  saveReadyDraft,
  titleTakenMessage,
} from "@/src/pipeline/draft/draft-store";
import type { ProducedDraft } from "@/src/pipeline/draft/produce-draft";
import { SAMPLE_CONTENT, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import { emailImageUrl, renderIssueEmailHtml } from "@/src/pipeline/draft/email-html";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";

const DATE = "2027-01-04";
const DAY = new Date(`${DATE}T00:00:00.000Z`);
const NOW = new Date("2027-01-04T15:00:00.000Z");
const LOCK = ["SELECT pg_advisory_xact_lock(hashtext(?))", `issue-date:${DATE}`];

async function outline(date = DATE): Promise<bigint> {
  const row = await fakeDb.client.approvalOutline.create({
    data: { issueDate: new Date(`${date}T00:00:00.000Z`), payload: { ...SAMPLE_OUTLINE, date }, payloadHash: "h" },
  });
  return (row as { id: bigint }).id;
}

async function issue(data: Record<string, unknown> = {}): Promise<bigint> {
  const row = await fakeDb.client.issue.create({ data: { title: "A draft", issueDate: DAY, ...data } });
  return (row as { id: bigint }).id;
}

function draftRow(draftId: number) {
  return fakeDb.state.drafts.rows.find((row) => row.id === BigInt(draftId))!;
}

function issueRow(issueId: number) {
  return fakeDb.state.issues.rows.find((row) => row.id === BigInt(issueId))!;
}

beforeEach(() => {
  fakeDb.reset();
  runLog.started.length = 0;
});

describe("createDraft", () => {
  it("creates the issue for a new date and draft v1, running, under a per-date lock", async () => {
    const outlineId = await outline();

    const created = await createDraft(outlineId);

    expect(fakeDb.state.issues.rows).toHaveLength(1);
    expect(fakeDb.state.issues.rows[0]).toMatchObject({ issueDate: DAY, publishedAt: null, title: `AI Recap draft ${DATE}` });
    expect(created).toEqual({ draftId: expect.any(Number), issueId: Number(fakeDb.state.issues.rows[0].id), version: 1, issueDate: DATE });
    expect(fakeDb.state.drafts.rows[0]).toMatchObject({ issueId: fakeDb.state.issues.rows[0].id, version: 1, outlineId, status: "running" });
    expect(fakeDb.state.locks).toEqual([LOCK]);
  });

  it("never makes a second issue for a date: the next commit is v2 of the same issue", async () => {
    const first = await createDraft(await outline());
    const second = await createDraft(await outline());

    expect(fakeDb.state.issues.rows).toHaveLength(1);
    expect(second).toMatchObject({ issueId: first.issueId, version: 2 });
    expect(second.draftId).not.toBe(first.draftId);
  });

  it("drafts into the date's issue when it already exists", async () => {
    const existing = await issue({ title: "Today" });
    await issue({ title: "Another day", issueDate: new Date("2027-01-05T00:00:00.000Z") });

    const created = await createDraft(await outline());

    expect(created).toMatchObject({ issueId: Number(existing), version: 1 });
    expect(fakeDb.state.issues.rows).toHaveLength(2);
  });

  it("stops when the date's issue is published, and creates nothing", async () => {
    const published = await issue({ title: "Sent", publishedAt: NOW });

    const attempt = createDraft(await outline());

    await expect(attempt).rejects.toBeInstanceOf(IssuePublishedError);
    // Only the fact: the draft job adds "Drafting stopped." where that is true.
    await expect(attempt).rejects.toMatchObject({ message: `The issue for ${DATE} (id ${published}) is already published.` });
    expect(fakeDb.state.drafts.rows).toHaveLength(0);
  });

  it("names an outline that does not exist", async () => {
    await expect(createDraft(42)).rejects.toThrow("Outline 42 does not exist.");
  });

  it("queues the draft at the given time", async () => {
    await createDraft(await outline(), { now: () => NOW });

    expect(fakeDb.state.drafts.rows[0]).toMatchObject({ queuedAt: NOW, startedAt: null });
  });
});

describe("isStuckDraft", () => {
  const queuedAt = new Date(NOW.getTime() - 6 * 60_000);

  it("is true for a running draft whose job died, or never started", () => {
    expect(isStuckDraft({ status: "running", queuedAt, startedAt: new Date(NOW.getTime() - 21 * 60_000) }, NOW)).toBe(true);
    expect(isStuckDraft({ status: "running", queuedAt, startedAt: null }, NOW)).toBe(true);
  });

  it("is false for a job still within its time, a fresh draft, and a finished draft", () => {
    expect(isStuckDraft({ status: "running", queuedAt, startedAt: new Date(NOW.getTime() - 60_000) }, NOW)).toBe(false);
    expect(isStuckDraft({ status: "running", queuedAt: new Date(NOW.getTime() - 4 * 60_000), startedAt: null }, NOW)).toBe(false);
    expect(isStuckDraft({ status: "failed", queuedAt, startedAt: null }, NOW)).toBe(false);
  });
});

describe("retryDraft", () => {
  async function failedDraft() {
    const created = await createDraft(await outline());
    await fakeDb.client.issueDraft.update({
      where: { id: BigInt(created.draftId) },
      data: { status: "failed", failedStep: "write", error: "The writer refused.", startedAt: NOW, finishedAt: NOW, content: { title: "x" } },
    });
    return created;
  }

  it("puts a failed draft back to running, cleared, so the job runs it again from the start", async () => {
    const created = await failedDraft();

    await expect(retryDraft(created.draftId, { now: () => NOW })).resolves.toEqual(created);

    expect(fakeDb.state.drafts.rows).toHaveLength(1);
    expect(fakeDb.state.drafts.rows[0]).toMatchObject({
      version: 1,
      status: "running",
      currentStep: null,
      failedStep: null,
      error: null,
      content: null,
      queuedAt: NOW,
      startedAt: null,
      finishedAt: null,
    });
  });

  it("clears everything the failed attempt made: the image, its scene prompt, the HTML, and the edit time", async () => {
    const created = await failedDraft();
    await fakeDb.client.issueDraft.update({
      where: { id: BigInt(created.draftId) },
      data: {
        failedStep: "save",
        content: SAMPLE_CONTENT,
        html: "<html>half made</html>",
        featuredImageUrl: "https://assets.example.test/newsletter-dev/2027-01-04-old.jpg",
        scenePrompt: "A pretend robot.",
        unreadStoryIds: [502],
        editedAt: new Date(NOW.getTime() - 60_000),
      },
    });

    await retryDraft(created.draftId, { now: () => NOW });

    expect(draftRow(created.draftId)).toMatchObject({
      status: "running",
      content: null,
      html: null,
      featuredImageUrl: null,
      scenePrompt: null,
      unreadStoryIds: [],
      editedAt: null,
    });
  });

  it("writes no run log", async () => {
    const created = await failedDraft();

    await retryDraft(created.draftId, { now: () => NOW });

    expect(runLog.started).toEqual([]);
  });

  it("refuses when another issue row for the date is published", async () => {
    const created = await failedDraft();
    const other = await issue({ title: "An n8n copy", publishedAt: NOW });

    await expect(retryDraft(created.draftId, { now: () => NOW })).rejects.toThrow(`(id ${other}) is already published`);
    expect(fakeDb.state.drafts.rows[0]).toMatchObject({ status: "failed" });
  });

  it("refuses a ready draft, a draft that is running now, and a published issue", async () => {
    const created = await failedDraft();
    const id = BigInt(created.draftId);

    await fakeDb.client.issueDraft.update({ where: { id }, data: { status: "ready" } });
    await expect(retryDraft(created.draftId, { now: () => NOW })).rejects.toBeInstanceOf(DraftNotRetryableError);

    await fakeDb.client.issueDraft.update({ where: { id }, data: { status: "running", startedAt: new Date(NOW.getTime() - 60_000) } });
    await expect(retryDraft(created.draftId, { now: () => NOW })).rejects.toThrow("is running now");

    await fakeDb.client.issueDraft.update({ where: { id }, data: { status: "failed" } });
    await fakeDb.client.issue.update({ where: { id: BigInt(created.issueId) }, data: { publishedAt: NOW } });
    await expect(retryDraft(created.draftId, { now: () => NOW })).rejects.toBeInstanceOf(IssuePublishedError);
  });

  it("names a draft that does not exist", async () => {
    await expect(retryDraft(999, { now: () => NOW })).rejects.toThrow("Draft 999 does not exist.");
  });

  it("retries a draft stuck in running longer than a background function can live", async () => {
    const created = await failedDraft();
    await fakeDb.client.issueDraft.update({
      where: { id: BigInt(created.draftId) },
      data: { status: "running", startedAt: new Date(NOW.getTime() - 21 * 60_000) },
    });

    await expect(retryDraft(created.draftId, { now: () => NOW })).resolves.toEqual(created);
  });

  it("retries a draft whose job never started, once it has waited 5 minutes", async () => {
    const created = await createDraft(await outline());
    const id = BigInt(created.draftId);

    await fakeDb.client.issueDraft.update({ where: { id }, data: { queuedAt: new Date(NOW.getTime() - 4 * 60_000) } });
    await expect(retryDraft(created.draftId, { now: () => NOW })).rejects.toThrow("is running now");

    await fakeDb.client.issueDraft.update({ where: { id }, data: { queuedAt: new Date(NOW.getTime() - 6 * 60_000) } });
    await expect(retryDraft(created.draftId, { now: () => NOW })).resolves.toEqual(created);
    expect(fakeDb.state.drafts.rows[0]).toMatchObject({ status: "running", queuedAt: NOW, startedAt: null });
  });
});

describe("the current draft: title and image changes (#149)", () => {
  const OLD_IMAGE = "https://assets.example.test/newsletter-dev/2027-01-04-old.jpg";
  const OLD_SCENE = "A pretend robot.";
  const OLD_HTML = "<html>v1 as the job made it</html>";
  const NEW_IMAGE = { imageUrl: "https://assets.example.test/newsletter-dev/2027-01-04-new.jpg", scenePrompt: "A pretend lighthouse." };
  const NEW_TITLE = "A Sample Robot Learns To Fold";
  const FINISHED = new Date("2027-01-04T14:00:00.000Z");

  /** v1 of the date's issue, ready, and copied to the issue row as the draft job does. */
  async function readyDraft() {
    const created = await createDraft(await outline());
    await fakeDb.client.issueDraft.update({
      where: { id: BigInt(created.draftId) },
      data: {
        status: "ready",
        content: SAMPLE_CONTENT,
        html: OLD_HTML,
        featuredImageUrl: OLD_IMAGE,
        scenePrompt: OLD_SCENE,
        unreadStoryIds: [502],
        startedAt: FINISHED,
        finishedAt: FINISHED,
      },
    });
    await fakeDb.client.issue.update({
      where: { id: BigInt(created.issueId) },
      data: {
        title: SAMPLE_CONTENT.title,
        html: OLD_HTML,
        featureImageUrl: OLD_IMAGE,
        promptFeaturedImage: OLD_SCENE,
        excerpt: SAMPLE_CONTENT.excerpt,
        contentJson: { title: SAMPLE_CONTENT.title },
      },
    });
    fakeDb.state.locks.length = 0;
    return created;
  }

  async function stagedVersionOf(draft: { draftId: number; issueId: number }) {
    await fakeDb.client.stagedVersion.create({
      data: {
        issueId: BigInt(draft.issueId),
        draftId: BigInt(draft.draftId),
        version: 1,
        title: SAMPLE_CONTENT.title,
        html: "<html>staged version 1</html>",
        featuredImageUrl: OLD_IMAGE,
        scenePrompt: OLD_SCENE,
        serviceRef: "example-ref-1",
        stagedAt: FINISHED,
      },
    });
  }

  function titleClash(): Error {
    return Object.assign(new Error("Unique constraint failed on the fields: (`slug`)"), { code: "P2002" });
  }

  describe("readCurrentDraft", () => {
    it("reads the issue's newest draft when it is ready", async () => {
      const draft = await readyDraft();

      await expect(readCurrentDraft(draft.draftId)).resolves.toEqual({
        draftId: draft.draftId,
        issueId: draft.issueId,
        version: 1,
        issueDate: DATE,
        content: SAMPLE_CONTENT,
        featuredImageUrl: OLD_IMAGE,
        scenePrompt: OLD_SCENE,
      });
    });

    it("changes nothing and takes no lock", async () => {
      const draft = await readyDraft();
      const before = structuredClone({ draft: draftRow(draft.draftId), issue: issueRow(draft.issueId) });

      await readCurrentDraft(draft.draftId);

      expect(draftRow(draft.draftId)).toEqual(before.draft);
      expect(issueRow(draft.issueId)).toEqual(before.issue);
      expect(fakeDb.state.locks).toEqual([]);
    });

    it("refuses a draft that does not exist", async () => {
      const attempt = readCurrentDraft(999);

      await expect(attempt).rejects.toBeInstanceOf(DraftEditError);
      await expect(attempt).rejects.toMatchObject({ name: "DraftEditError", reason: "missing", message: "Draft 999 does not exist." });
    });

    it("refuses a draft whose issue has no date", async () => {
      const draft = await readyDraft();
      await fakeDb.client.issue.update({ where: { id: BigInt(draft.issueId) }, data: { issueDate: null } });

      await expect(readCurrentDraft(draft.draftId)).rejects.toMatchObject({ reason: "missing", message: `Draft ${draft.draftId} has no issue date.` });
    });

    it.each(["running", "failed"] as const)("refuses the newest draft while it is %s", async (status) => {
      const draft = await createDraft(await outline());
      await fakeDb.client.issueDraft.update({ where: { id: BigInt(draft.draftId) }, data: { status } });

      const attempt = readCurrentDraft(draft.draftId);

      await expect(attempt).rejects.toMatchObject({ name: "DraftEditError", reason: "not_ready" });
      await expect(attempt).rejects.toThrow(`The draft for ${DATE} is ${status}. Only a ready draft can be changed.`);
    });

    it("refuses a ready draft that has no content", async () => {
      const draft = await readyDraft();
      await fakeDb.client.issueDraft.update({ where: { id: BigInt(draft.draftId) }, data: { content: null } });

      await expect(readCurrentDraft(draft.draftId)).rejects.toMatchObject({ reason: "not_ready" });
    });

    it.each(["running", "ready", "failed"] as const)("refuses v1 once a newer draft exists, even a %s one", async (status) => {
      const v1 = await readyDraft();
      const v2 = await createDraft(await outline());
      await fakeDb.client.issueDraft.update({ where: { id: BigInt(v2.draftId) }, data: { status, content: SAMPLE_CONTENT } });

      const attempt = readCurrentDraft(v1.draftId);

      await expect(attempt).rejects.toMatchObject({ name: "DraftEditError", reason: "not_current" });
      await expect(attempt).rejects.toThrow(`This is not the newest draft for ${DATE}. Reload the page.`);
    });

    it("refuses once the issue is published, or another issue row for the date is", async () => {
      const draft = await readyDraft();
      const other = await issue({ title: "An n8n copy", publishedAt: NOW });

      await expect(readCurrentDraft(draft.draftId)).rejects.toThrow(`(id ${other}) is already published`);

      await fakeDb.client.issue.deleteMany({ where: { id: other } });
      await fakeDb.client.issue.update({ where: { id: BigInt(draft.issueId) }, data: { publishedAt: NOW } });
      await expect(readCurrentDraft(draft.draftId)).rejects.toBeInstanceOf(IssuePublishedError);
    });
  });

  describe("editCurrentDraft: a new title", () => {
    it("puts the title into the same draft row, builds its email HTML again, and sets the edit time", async () => {
      const draft = await readyDraft();

      const changed = await editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW });

      const content = { ...SAMPLE_CONTENT, title: NEW_TITLE };
      expect(changed).toEqual({
        draftId: draft.draftId,
        issueId: draft.issueId,
        version: 1,
        issueDate: DATE,
        content,
        featuredImageUrl: OLD_IMAGE,
        scenePrompt: OLD_SCENE,
      });
      const row = draftRow(draft.draftId);
      expect(row).toMatchObject({
        id: BigInt(draft.draftId),
        issueId: BigInt(draft.issueId),
        version: 1,
        status: "ready",
        content,
        featuredImageUrl: OLD_IMAGE,
        scenePrompt: OLD_SCENE,
        unreadStoryIds: [502],
        finishedAt: FINISHED,
        editedAt: NOW,
      });
      expect(row.html).toBe(
        renderIssueEmailHtml(content, { id: draft.issueId, issueDate: DATE }, { id: draft.draftId, featuredImageUrl: OLD_IMAGE }),
      );
      expect(row.html).toContain(NEW_TITLE);
      expect(row.html).not.toContain(SAMPLE_CONTENT.title);
      expect(row.html).toContain(`url=${OLD_IMAGE}"`);
      expect(row.html).toContain(`data-issue-id="${draft.issueId}"`);
      expect(row.html).toContain(`data-draft-id="${draft.draftId}"`);
      // The draft's own HTML is the preview: only a staged version's email carries a version id.
      expect(row.html).not.toContain("data-version-id");
    });

    it("updates the issue row to match: title, HTML, image, scene prompt, excerpt, and content", async () => {
      const draft = await readyDraft();

      await editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW });

      const content = { ...SAMPLE_CONTENT, title: NEW_TITLE };
      const stored = issueRow(draft.issueId);
      expect(stored).toMatchObject({
        title: NEW_TITLE,
        html: draftRow(draft.draftId).html,
        featureImageUrl: OLD_IMAGE,
        promptFeaturedImage: OLD_SCENE,
        excerpt: SAMPLE_CONTENT.excerpt,
        issueDate: DAY,
        publishedAt: null,
      });
      expect(stored.contentJson).toEqual(
        toIssueContentJson(content, { issueId: draft.issueId, issueDate: DATE, featuredImageUrl: emailImageUrl(OLD_IMAGE) }),
      );
    });

    it("keeps a missing image and scene prompt as null, on the draft and on the issue", async () => {
      const draft = await readyDraft();
      await fakeDb.client.issueDraft.update({ where: { id: BigInt(draft.draftId) }, data: { featuredImageUrl: null, scenePrompt: null } });

      const changed = await editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW });

      expect(changed).toMatchObject({ featuredImageUrl: null, scenePrompt: null });
      expect(draftRow(draft.draftId)).toMatchObject({ featuredImageUrl: null, scenePrompt: null, editedAt: NOW });
      expect(draftRow(draft.draftId).html).toContain(NEW_TITLE);
      expect(issueRow(draft.issueId)).toMatchObject({ title: NEW_TITLE, featureImageUrl: null, promptFeaturedImage: null });
    });

    it("makes no new draft, no new issue, and no staged version", async () => {
      const draft = await readyDraft();

      await editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW });

      expect(fakeDb.state.drafts.rows).toHaveLength(1);
      expect(fakeDb.state.issues.rows).toHaveLength(1);
      expect(fakeDb.state.stagedVersions.rows).toHaveLength(0);
      expect(runLog.started).toEqual([]);
    });

    it("runs under the date's lock", async () => {
      const draft = await readyDraft();

      await editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW });

      expect(fakeDb.state.locks).toEqual([LOCK]);
    });

    it("leaves a staged version as it was: it keeps its own copy", async () => {
      const draft = await readyDraft();
      await stagedVersionOf(draft);
      const before = structuredClone(fakeDb.state.stagedVersions.rows);

      await editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW });

      expect(fakeDb.state.stagedVersions.rows).toEqual(before);
      expect(fakeDb.state.stagedVersions.updates).toEqual([]);
    });

    it("undoes everything and says the title is taken when another issue already has it", async () => {
      const draft = await readyDraft();
      const before = structuredClone({ draft: draftRow(draft.draftId), issue: issueRow(draft.issueId) });
      fakeDb.state.issueUpdateError = titleClash();

      const error = await editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW }).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(DraftEditError);
      expect(error).toMatchObject({
        name: "DraftEditError",
        reason: "title_taken",
        message: titleTakenMessage(NEW_TITLE, "Use a different title."),
      });
      expect(draftRow(draft.draftId)).toEqual(before.draft);
      expect(issueRow(draft.issueId)).toEqual(before.issue);
      expect(fakeDb.state.drafts.rows).toHaveLength(1);
    });

    it("can be changed again after a taken title", async () => {
      const draft = await readyDraft();
      fakeDb.state.issueUpdateError = titleClash();
      await editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW }).catch(() => null);

      await expect(editCurrentDraft(draft.draftId, { title: "Another Pretend Title" }, { now: () => NOW })).resolves.toMatchObject({ version: 1 });

      expect(draftRow(draft.draftId)).toMatchObject({ content: { ...SAMPLE_CONTENT, title: "Another Pretend Title" }, editedAt: NOW });
      expect(issueRow(draft.issueId)).toMatchObject({ title: "Another Pretend Title" });
    });

    it("passes on any other database error, and undoes the draft's change", async () => {
      const draft = await readyDraft();
      const before = structuredClone(draftRow(draft.draftId));
      fakeDb.state.issueUpdateError = new Error("database down");

      await expect(editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW })).rejects.toThrow("database down");

      expect(draftRow(draft.draftId)).toEqual(before);
    });
  });

  describe("editCurrentDraft: a new image", () => {
    it("puts the image and its scene prompt into the same draft row, and builds its email HTML again", async () => {
      const draft = await readyDraft();

      const changed = await editCurrentDraft(draft.draftId, { image: NEW_IMAGE }, { now: () => NOW });

      expect(changed).toEqual({
        draftId: draft.draftId,
        issueId: draft.issueId,
        version: 1,
        issueDate: DATE,
        content: SAMPLE_CONTENT,
        featuredImageUrl: NEW_IMAGE.imageUrl,
        scenePrompt: NEW_IMAGE.scenePrompt,
      });
      const row = draftRow(draft.draftId);
      expect(row).toMatchObject({
        version: 1,
        status: "ready",
        content: SAMPLE_CONTENT,
        featuredImageUrl: NEW_IMAGE.imageUrl,
        scenePrompt: NEW_IMAGE.scenePrompt,
        editedAt: NOW,
      });
      expect(row.html).toBe(
        renderIssueEmailHtml(SAMPLE_CONTENT, { id: draft.issueId, issueDate: DATE }, { id: draft.draftId, featuredImageUrl: NEW_IMAGE.imageUrl }),
      );
      expect(row.html).toContain(`url=${NEW_IMAGE.imageUrl}"`);
      expect(row.html).not.toContain(OLD_IMAGE);
      expect(row.html).toContain(SAMPLE_CONTENT.title);
    });

    it("updates the issue row to match, keeping the title", async () => {
      const draft = await readyDraft();

      await editCurrentDraft(draft.draftId, { image: NEW_IMAGE }, { now: () => NOW });

      const stored = issueRow(draft.issueId);
      expect(stored).toMatchObject({
        title: SAMPLE_CONTENT.title,
        html: draftRow(draft.draftId).html,
        featureImageUrl: NEW_IMAGE.imageUrl,
        promptFeaturedImage: NEW_IMAGE.scenePrompt,
        excerpt: SAMPLE_CONTENT.excerpt,
      });
      expect(stored.contentJson).toEqual(
        toIssueContentJson(SAMPLE_CONTENT, { issueId: draft.issueId, issueDate: DATE, featuredImageUrl: emailImageUrl(NEW_IMAGE.imageUrl) }),
      );
    });

    it("makes no new draft and no staged version, leaves a staged version as it was, and runs under the date's lock", async () => {
      const draft = await readyDraft();
      await stagedVersionOf(draft);
      const before = structuredClone(fakeDb.state.stagedVersions.rows);

      await editCurrentDraft(draft.draftId, { image: NEW_IMAGE }, { now: () => NOW });

      expect(fakeDb.state.drafts.rows).toHaveLength(1);
      expect(fakeDb.state.stagedVersions.rows).toEqual(before);
      expect(fakeDb.state.locks).toEqual([LOCK]);
    });

    it("does not call a unique clash a taken title, since the title did not change", async () => {
      const draft = await readyDraft();
      const before = structuredClone(draftRow(draft.draftId));
      fakeDb.state.issueUpdateError = titleClash();

      const error = await editCurrentDraft(draft.draftId, { image: NEW_IMAGE }, { now: () => NOW }).catch((reason: unknown) => reason);

      expect(error).not.toBeInstanceOf(DraftEditError);
      expect(error).toMatchObject({ code: "P2002" });
      expect(draftRow(draft.draftId)).toEqual(before);
    });
  });

  it("keeps an earlier title change when the image changes, and the other way round", async () => {
    const draft = await readyDraft();
    const later = new Date(NOW.getTime() + 60_000);

    await editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW });
    await editCurrentDraft(draft.draftId, { image: NEW_IMAGE }, { now: () => later });

    const row = draftRow(draft.draftId);
    expect(row).toMatchObject({ version: 1, content: { ...SAMPLE_CONTENT, title: NEW_TITLE }, featuredImageUrl: NEW_IMAGE.imageUrl, editedAt: later });
    expect(row.html).toContain(NEW_TITLE);
    expect(row.html).toContain(`url=${NEW_IMAGE.imageUrl}"`);
    expect(issueRow(draft.issueId)).toMatchObject({ title: NEW_TITLE, featureImageUrl: NEW_IMAGE.imageUrl, html: row.html });
    expect(fakeDb.state.drafts.rows).toHaveLength(1);

    await editCurrentDraft(draft.draftId, { title: "Another Pretend Title" }, { now: () => later });
    expect(draftRow(draft.draftId)).toMatchObject({ featuredImageUrl: NEW_IMAGE.imageUrl, scenePrompt: NEW_IMAGE.scenePrompt });
    expect(draftRow(draft.draftId).html).toContain(`url=${NEW_IMAGE.imageUrl}"`);
  });

  describe("editCurrentDraft: refusals", () => {
    const EDITS = [
      ["a new title", { title: NEW_TITLE }],
      ["a new image", { image: NEW_IMAGE }],
    ] as const;

    it.each(EDITS)("refuses %s for a draft that does not exist", async (_name, edit) => {
      await readyDraft();

      await expect(editCurrentDraft(999, edit, { now: () => NOW })).rejects.toMatchObject({ name: "DraftEditError", reason: "missing" });
      expect(fakeDb.state.locks).toEqual([]);
    });

    it.each(EDITS)("refuses %s once the issue is published, and never changes it", async (_name, edit) => {
      const draft = await readyDraft();
      await fakeDb.client.issue.update({ where: { id: BigInt(draft.issueId) }, data: { publishedAt: NOW } });
      const before = structuredClone({ draft: draftRow(draft.draftId), issue: issueRow(draft.issueId) });

      const attempt = editCurrentDraft(draft.draftId, edit, { now: () => NOW });

      await expect(attempt).rejects.toBeInstanceOf(IssuePublishedError);
      await expect(attempt).rejects.toThrow(`The issue for ${DATE} (id ${draft.issueId}) is already published.`);
      expect(draftRow(draft.draftId)).toEqual(before.draft);
      expect(issueRow(draft.issueId)).toEqual(before.issue);
    });

    it("refuses when another issue row for the date is published", async () => {
      const draft = await readyDraft();
      const before = structuredClone(draftRow(draft.draftId));
      const other = await issue({ title: "An n8n copy", publishedAt: NOW });

      await expect(editCurrentDraft(draft.draftId, { title: NEW_TITLE }, { now: () => NOW })).rejects.toThrow(`(id ${other}) is already published`);
      expect(draftRow(draft.draftId)).toEqual(before);
    });

    it.each(["running", "ready", "failed"] as const)(
      "refuses to change v1 once v2 exists and is %s, under the date's lock, and changes neither draft",
      async (status) => {
        const v1 = await readyDraft();
        const v2 = await createDraft(await outline());
        await fakeDb.client.issueDraft.update({ where: { id: BigInt(v2.draftId) }, data: { status, content: SAMPLE_CONTENT } });
        fakeDb.state.locks.length = 0;
        const before = structuredClone({ drafts: fakeDb.state.drafts.rows, issue: issueRow(v1.issueId) });

        const attempt = editCurrentDraft(v1.draftId, { title: NEW_TITLE }, { now: () => NOW });

        await expect(attempt).rejects.toMatchObject({ name: "DraftEditError", reason: "not_current" });
        await expect(attempt).rejects.toThrow(`This is not the newest draft for ${DATE}. Reload the page.`);
        expect(fakeDb.state.locks).toEqual([LOCK]);
        expect(fakeDb.state.drafts.rows).toEqual(before.drafts);
        expect(issueRow(v1.issueId)).toEqual(before.issue);
      },
    );

    it("changes v2, the newest draft, and leaves v1 alone", async () => {
      const v1 = await readyDraft();
      const v2 = await createDraft(await outline());
      await fakeDb.client.issueDraft.update({
        where: { id: BigInt(v2.draftId) },
        data: { status: "ready", content: SAMPLE_CONTENT, html: "<html>v2</html>", featuredImageUrl: OLD_IMAGE, scenePrompt: OLD_SCENE },
      });
      const v1Before = structuredClone(draftRow(v1.draftId));

      await expect(editCurrentDraft(v2.draftId, { title: NEW_TITLE }, { now: () => NOW })).resolves.toMatchObject({ draftId: v2.draftId, version: 2 });

      expect(draftRow(v1.draftId)).toEqual(v1Before);
      expect(draftRow(v2.draftId)).toMatchObject({ version: 2, editedAt: NOW });
      expect(draftRow(v2.draftId).html).toContain(`data-draft-id="${v2.draftId}"`);
      expect(issueRow(v1.issueId)).toMatchObject({ title: NEW_TITLE, html: draftRow(v2.draftId).html });
    });

    it.each(["running", "failed"] as const)("refuses a draft that is %s, and changes nothing", async (status) => {
      const draft = await createDraft(await outline());
      await fakeDb.client.issueDraft.update({ where: { id: BigInt(draft.draftId) }, data: { status, content: SAMPLE_CONTENT } });
      const before = structuredClone({ draft: draftRow(draft.draftId), issue: issueRow(draft.issueId) });

      const attempt = editCurrentDraft(draft.draftId, { image: NEW_IMAGE }, { now: () => NOW });

      await expect(attempt).rejects.toMatchObject({ name: "DraftEditError", reason: "not_ready" });
      await expect(attempt).rejects.toThrow(`The draft for ${DATE} is ${status}. Only a ready draft can be changed.`);
      expect(draftRow(draft.draftId)).toEqual(before.draft);
      expect(issueRow(draft.issueId)).toEqual(before.issue);
    });
  });

  it("writes the taken-title message with the title and what to do next", () => {
    expect(titleTakenMessage("Pretend Title", "Use a different title.")).toBe(
      'Another issue already uses the title "Pretend Title", and titles must be unique. Use a different title.',
    );
  });

  it("shows the board the edit time, and that an older draft has a newer one whatever its status", async () => {
    const v1 = await readyDraft();

    await expect(getDraftStatus(v1.draftId)).resolves.toMatchObject({ editedAt: null, hasNewerDraft: false, issuePublished: false });

    await editCurrentDraft(v1.draftId, { title: NEW_TITLE }, { now: () => NOW });
    await expect(getDraftStatus(v1.draftId)).resolves.toMatchObject({
      subject: NEW_TITLE,
      editedAt: NOW,
      featuredImageUrl: OLD_IMAGE,
      scenePrompt: OLD_SCENE,
      hasNewerDraft: false,
    });

    const v2 = await createDraft(await outline());
    for (const status of ["running", "failed", "ready"] as const) {
      await fakeDb.client.issueDraft.update({ where: { id: BigInt(v2.draftId) }, data: { status } });

      await expect(getDraftStatus(v1.draftId)).resolves.toMatchObject({ hasNewerDraft: true });
      await expect(getDraftStatus(v2.draftId)).resolves.toMatchObject({ hasNewerDraft: false });
    }

    await fakeDb.client.issue.update({ where: { id: BigInt(v1.issueId) }, data: { publishedAt: NOW } });
    await expect(getDraftStatus(v1.draftId)).resolves.toMatchObject({ issuePublished: true });
  });
});

describe("saveReadyDraft", () => {
  const PRODUCED: ProducedDraft = {
    content: SAMPLE_CONTENT,
    html: "<html>as the job made it</html>",
    featuredImageUrl: "https://assets.example.test/newsletter-dev/2027-01-04-abc.jpg",
    scenePrompt: "A pretend robot.",
    unreadStoryIds: [],
    stepMs: {},
  };

  async function save(draftId: number) {
    const draft = await findDraftToRun(draftId);
    return saveReadyDraft({ ...draft!, issueDate: DATE }, PRODUCED, NOW);
  }

  it("marks the draft ready, copies it to the issue, and says it is the issue's newest draft", async () => {
    const v1 = await createDraft(await outline());

    await expect(save(v1.draftId)).resolves.toEqual({ issue: "updated", newest: true });
    expect(draftRow(v1.draftId)).toMatchObject({ status: "ready", html: PRODUCED.html, finishedAt: NOW });
    expect(issueRow(v1.issueId)).toMatchObject({ title: SAMPLE_CONTENT.title, html: PRODUCED.html });
  });

  it.each(["running", "failed"] as const)("still copies v1 to the issue while v2 is %s, but says v1 is not the newest draft", async (status) => {
    const v1 = await createDraft(await outline());
    const v2 = await createDraft(await outline());
    await fakeDb.client.issueDraft.update({ where: { id: BigInt(v2.draftId) }, data: { status } });

    await expect(save(v1.draftId)).resolves.toEqual({ issue: "updated", newest: false });
    expect(issueRow(v1.issueId)).toMatchObject({ html: PRODUCED.html });
  });

  it("leaves the issue to a newer ready draft", async () => {
    const v1 = await createDraft(await outline());
    const v2 = await createDraft(await outline());
    await expect(save(v2.draftId)).resolves.toEqual({ issue: "updated", newest: true });
    await fakeDb.client.issue.update({ where: { id: BigInt(v2.issueId) }, data: { html: "<html>v2</html>" } });

    await expect(save(v1.draftId)).resolves.toEqual({ issue: "newer_draft", newest: false });
    expect(draftRow(v1.draftId)).toMatchObject({ status: "ready" });
    expect(issueRow(v1.issueId)).toMatchObject({ html: "<html>v2</html>" });
  });

  it("changes no issue once one for the date is published", async () => {
    const v1 = await createDraft(await outline());
    await issue({ title: "An n8n copy", publishedAt: NOW });

    await expect(save(v1.draftId)).resolves.toEqual({ issue: "published", newest: true });
    expect(issueRow(v1.issueId)).toMatchObject({ html: null });
  });
});

describe("draft reads for the board", () => {
  it("reads one draft's status for the live progress, and its HTML for the preview", async () => {
    const created = await createDraft(await outline());
    await fakeDb.client.issueDraft.update({
      where: { id: BigInt(created.draftId) },
      data: { currentStep: "image", startedAt: NOW, unreadStoryIds: [501, 503] },
    });

    await expect(getDraftStatus(created.draftId)).resolves.toMatchObject({
      id: created.draftId,
      issueId: created.issueId,
      issueDate: DATE,
      version: 1,
      status: "running",
      currentStep: "image",
      failedStep: null,
      error: null,
      hasHtml: false,
      unreadStoryIds: [501, 503],
      startedAt: NOW,
      finishedAt: null,
      editedAt: null,
    });
    await expect(getDraftStatus(999)).resolves.toBeNull();
    await expect(getDraftHtml(created.draftId)).resolves.toBeNull();

    await fakeDb.client.issueDraft.update({ where: { id: BigInt(created.draftId) }, data: { html: "<html>draft</html>" } });
    await expect(getDraftHtml(created.draftId)).resolves.toBe("<html>draft</html>");
  });

  it("carries no distribution service fields and no source draft: a draft is not an email in the service", async () => {
    const created = await createDraft(await outline());

    const view = await getDraftStatus(created.draftId);

    for (const gone of ["ghlTemplateId", "ghlPreviewUrl", "sourceDraftId", "sourceVersion"]) {
      expect(view).not.toHaveProperty(gone);
    }
  });
});
