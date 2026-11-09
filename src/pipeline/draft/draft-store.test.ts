import { beforeEach, describe, expect, it, vi } from "vitest";

const runLog = vi.hoisted(() => ({ started: [] as unknown[], events: [] as unknown[], finished: [] as unknown[] }));

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});
vi.mock("@/src/pipeline/runs", () => ({
  startRun: vi.fn(async (input: unknown) => {
    runLog.started.push(input);
    return BigInt(9);
  }),
  logEvent: vi.fn(async (_runId: bigint, event: unknown) => {
    runLog.events.push(event);
  }),
  finishRun: vi.fn(async (_runId: bigint, result: unknown) => {
    runLog.finished.push(result);
  }),
}));

import {
  createDraft,
  DraftNotRetryableError,
  DraftOwnerError,
  getDraftHtml,
  getDraftStatus,
  isStuckDraft,
  IssuePublishedError,
  listDraftsForDate,
  retryDraft,
} from "@/src/pipeline/draft/draft-store";
import { SAMPLE_CONTENT, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";

const DATE = "2027-01-04";
const DAY = new Date(`${DATE}T00:00:00.000Z`);
const NOW = new Date("2027-01-04T15:00:00.000Z");

async function outline(date = DATE): Promise<bigint> {
  const row = await fakeDb.client.approvalOutline.create({
    data: { issueDate: new Date(`${date}T00:00:00.000Z`), payload: { ...SAMPLE_OUTLINE, date }, payloadHash: "h", draftOwner: "native" },
  });
  return (row as { id: bigint }).id;
}

async function issue(data: Record<string, unknown> = {}): Promise<bigint> {
  const row = await fakeDb.client.issue.create({ data: { title: "An n8n draft", issueDate: DAY, ...data } });
  return (row as { id: bigint }).id;
}

beforeEach(() => {
  fakeDb.reset();
  runLog.started.length = 0;
  runLog.events.length = 0;
  runLog.finished.length = 0;
});

describe("createDraft", () => {
  it("creates the issue for a new date and draft v1, running, under a per-date lock", async () => {
    const outlineId = await outline();

    const created = await createDraft(outlineId);

    expect(fakeDb.state.issues.rows).toHaveLength(1);
    expect(fakeDb.state.issues.rows[0]).toMatchObject({ issueDate: DAY, publishedAt: null, title: `AI Recap draft ${DATE}` });
    expect(created).toEqual({ draftId: expect.any(Number), issueId: Number(fakeDb.state.issues.rows[0].id), version: 1, issueDate: DATE });
    expect(fakeDb.state.drafts.rows[0]).toMatchObject({ issueId: fakeDb.state.issues.rows[0].id, version: 1, outlineId, status: "running" });
    expect(fakeDb.state.locks).toEqual([["SELECT pg_advisory_xact_lock(hashtext(?))", `issue-date:${DATE}`]]);
  });

  it("never makes a second issue for a date: the next commit is v2 of the same issue", async () => {
    const first = await createDraft(await outline());
    const second = await createDraft(await outline());

    expect(fakeDb.state.issues.rows).toHaveLength(1);
    expect(second).toMatchObject({ issueId: first.issueId, version: 2 });
    expect(second.draftId).not.toBe(first.draftId);
  });

  it("drafts into the latest unpublished issue when n8n left several for the date", async () => {
    await issue({ title: "Older n8n draft" });
    const latest = await issue({ title: "Newer n8n draft" });
    await issue({ title: "Another day", issueDate: new Date("2027-01-05T00:00:00.000Z") });

    const created = await createDraft(await outline());

    expect(created).toMatchObject({ issueId: Number(latest), version: 1 });
    expect(fakeDb.state.issues.rows).toHaveLength(3);
  });

  it("stops when the date's issue is published, and creates nothing", async () => {
    await issue({ title: "Unpublished duplicate" });
    const published = await issue({ title: "Sent", publishedAt: NOW });

    const attempt = createDraft(await outline());

    await expect(attempt).rejects.toBeInstanceOf(IssuePublishedError);
    await expect(attempt).rejects.toThrow(`The issue for ${DATE} (id ${published}) is already published. Drafting stopped.`);
    expect(fakeDb.state.drafts.rows).toHaveLength(0);
  });

  it("names an outline that does not exist", async () => {
    await expect(createDraft(42)).rejects.toThrow("Outline 42 does not exist.");
  });

  it("queues the draft at the given time", async () => {
    await createDraft(await outline(), { now: () => NOW });

    expect(fakeDb.state.drafts.rows[0]).toMatchObject({ queuedAt: NOW, startedAt: null });
  });

  it("refuses while n8n owns drafting, and creates nothing", async () => {
    fakeDb.state.settings.rows[0].value = "n8n";

    const attempt = createDraft(await outline());

    await expect(attempt).rejects.toBeInstanceOf(DraftOwnerError);
    await expect(attempt).rejects.toThrow("draft.owner is n8n, so native drafting is off.");
    expect(fakeDb.state.issues.rows).toHaveLength(0);
    expect(fakeDb.state.drafts.rows).toHaveLength(0);
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
    expect(runLog.started).toEqual([]);
  });

  it("logs the old GHL template id before clearing it, since the retry makes a new template", async () => {
    const created = await failedDraft();
    await fakeDb.client.issueDraft.update({
      where: { id: BigInt(created.draftId) },
      data: { failedStep: "save", ghlTemplateId: "tpl-old", ghlPreviewUrl: "https://preview.example.test/tpl-old" },
    });

    await retryDraft(created.draftId, { now: () => NOW });

    expect(runLog.started).toEqual([{ job: "draft-retry", trigger: "manual" }]);
    expect(runLog.events).toEqual([
      expect.objectContaining({
        step: "retry",
        message: expect.stringContaining("tpl-old"),
        data: expect.objectContaining({ draftId: created.draftId, ghlTemplateId: "tpl-old" }),
      }),
    ]);
    expect(runLog.finished).toEqual([expect.objectContaining({ status: "succeeded" })]);
    expect(fakeDb.state.drafts.rows[0]).toMatchObject({ ghlTemplateId: null, ghlPreviewUrl: null });
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

describe("draft reads for the board", () => {
  it("lists every draft for the date, newest first, with subject, status, GHL link, and which one was sent", async () => {
    const v1 = await createDraft(await outline());
    const v2 = await createDraft(await outline());
    await fakeDb.client.issueDraft.update({
      where: { id: BigInt(v1.draftId) },
      data: { status: "ready", content: SAMPLE_CONTENT, html: "<html>v1</html>", ghlTemplateId: "t1", ghlPreviewUrl: "https://p/1", finishedAt: NOW },
    });
    await fakeDb.client.issueDraft.update({
      where: { id: BigInt(v2.draftId) },
      data: { status: "failed", failedStep: "ghl", error: "GHL said no.", finishedAt: NOW },
    });
    await fakeDb.client.publishEvent.create({ data: { mode: "native", outcome: "published", draftId: BigInt(v1.draftId) } });
    await createDraft(await outline("2027-01-05"));

    const drafts = await listDraftsForDate(DATE);

    expect(drafts.map((draft) => [draft.version, draft.status, draft.sent, draft.current])).toEqual([
      [2, "failed", false, false],
      [1, "ready", true, true],
    ]);
    expect(drafts[1]).toMatchObject({
      id: v1.draftId,
      issueId: v1.issueId,
      issueDate: DATE,
      subject: SAMPLE_CONTENT.title,
      hasHtml: true,
      ghlTemplateId: "t1",
      ghlPreviewUrl: "https://p/1",
      finishedAt: NOW,
    });
    expect(drafts[0]).toMatchObject({ subject: null, failedStep: "ghl", error: "GHL said no.", hasHtml: false });
    await expect(listDraftsForDate("2027-02-01")).resolves.toEqual([]);
  });

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
      ghlTemplateId: null,
      ghlPreviewUrl: null,
      unreadStoryIds: [501, 503],
      startedAt: NOW,
      finishedAt: null,
    });
    await expect(getDraftStatus(999)).resolves.toBeNull();
    await expect(getDraftHtml(created.draftId)).resolves.toBeNull();

    await fakeDb.client.issueDraft.update({ where: { id: BigInt(created.draftId) }, data: { html: "<html>draft</html>" } });
    await expect(getDraftHtml(created.draftId)).resolves.toBe("<html>draft</html>");
  });
});
