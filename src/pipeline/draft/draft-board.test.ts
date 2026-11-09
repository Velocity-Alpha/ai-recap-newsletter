import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});

import {
  draftStepLabel,
  draftSteps,
  listDraftsForBoard,
  readDraftForBoard,
  toDraftBoardView,
} from "@/src/pipeline/draft/draft-board";
import { DRAFT_START_STEP, NEVER_STARTED_AFTER_MS, STUCK_AFTER_MS, type DraftView } from "@/src/pipeline/draft/draft-store";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";

const NOW = new Date("2027-01-04T15:00:00.000Z");
const DAY = new Date("2027-01-04T00:00:00.000Z");

function view(data: Partial<DraftView> = {}): DraftView {
  return {
    id: 7,
    issueId: 3,
    issueDate: "2027-01-04",
    version: 2,
    status: "running",
    currentStep: null,
    failedStep: null,
    error: null,
    subject: null,
    hasHtml: false,
    ghlTemplateId: null,
    ghlPreviewUrl: null,
    unreadStoryIds: [],
    createdAt: new Date("2027-01-04T14:58:00.000Z"),
    queuedAt: new Date("2027-01-04T14:58:00.000Z"),
    startedAt: null,
    finishedAt: null,
    featuredImageUrl: null,
    scenePrompt: null,
    sourceDraftId: null,
    sourceVersion: null,
    issuePublished: false,
    hasNewerDraft: false,
    ...data,
  };
}

function states(data: Partial<DraftView>) {
  return Object.fromEntries(draftSteps(view(data)).map((step) => [step.key, step.state]));
}

beforeEach(() => fakeDb.reset());

describe("draftSteps", () => {
  it("lists every step of the job, in order, with plain labels", () => {
    expect(draftSteps(view()).map((step) => [step.key, step.label])).toEqual([
      ["load", "loading the outline"],
      ["read_articles", "reading articles"],
      ["write", "writing"],
      ["validate", "checking the writing"],
      ["image", "making the image"],
      ["html", "building the email"],
      ["ghl", "creating the GHL template"],
      ["save", "saving the draft"],
    ]);
  });

  it("marks steps done, current, and waiting while the draft runs", () => {
    expect(states({ currentStep: "image", startedAt: NOW })).toEqual({
      load: "done",
      read_articles: "done",
      write: "done",
      validate: "done",
      image: "current",
      html: "waiting",
      ghl: "waiting",
      save: "waiting",
    });
    expect(Object.values(states({}))).toEqual(Array(8).fill("waiting"));
  });

  it("marks the failed step, and every step done when ready", () => {
    expect(states({ status: "failed", failedStep: "write" })).toMatchObject({ read_articles: "done", write: "failed", validate: "waiting" });
    expect(Object.values(states({ status: "ready" }))).toEqual(Array(8).fill("done"));
    expect(Object.values(states({ status: "failed", failedStep: DRAFT_START_STEP }))).toEqual(Array(8).fill("waiting"));
  });

  it("lists only the steps a new image draft runs (#116)", () => {
    expect(states({ sourceDraftId: 6, sourceVersion: 1, currentStep: "html", startedAt: NOW })).toEqual({
      load: "done",
      image: "done",
      html: "current",
      ghl: "waiting",
      save: "waiting",
    });
    expect(states({ sourceDraftId: 6, status: "failed", failedStep: "image" })).toEqual({
      load: "done",
      image: "failed",
      html: "waiting",
      ghl: "waiting",
      save: "waiting",
    });
  });
});

describe("draftStepLabel", () => {
  it("names the job's steps and the start of the job", () => {
    expect(draftStepLabel("ghl")).toBe("creating the GHL template");
    expect(draftStepLabel(DRAFT_START_STEP)).toBe("starting the draft job");
    expect(draftStepLabel("something_new")).toBe("something_new");
    expect(draftStepLabel(null)).toBeNull();
  });
});

describe("toDraftBoardView", () => {
  it("gives the board labels, dates as text, and whether Retry is allowed", () => {
    const board = toDraftBoardView(view({ status: "failed", failedStep: "ghl", error: "GHL said 401.", finishedAt: NOW }), { now: NOW });

    expect(board).toMatchObject({
      id: 7,
      version: 2,
      status: "failed",
      failedStepLabel: "creating the GHL template",
      error: "GHL said 401.",
      retryable: true,
      finishedAt: NOW.toISOString(),
      createdAt: "2027-01-04T14:58:00.000Z",
      unreadStories: [],
    });
  });

  it("allows Retry on a draft stuck in running, like retryDraft", () => {
    const fresh = view({ currentStep: "write", startedAt: new Date(NOW.getTime() - 60_000) });
    const stuck = view({ currentStep: "write", startedAt: new Date(NOW.getTime() - STUCK_AFTER_MS - 1) });

    expect(toDraftBoardView(fresh, { now: NOW })).toMatchObject({ retryable: false, stepLabel: "writing" });
    expect(toDraftBoardView(stuck, { now: NOW }).retryable).toBe(true);
    expect(toDraftBoardView(view({ status: "ready" }), { now: NOW }).retryable).toBe(false);
  });

  it("offers New image only on the newest ready draft, with nothing newer running, while the issue is not published (#116)", () => {
    const ready = view({ status: "ready", hasHtml: true, featuredImageUrl: "https://img.example.test/a.jpg", scenePrompt: "A lamp." });

    expect(toDraftBoardView(ready, { now: NOW })).toMatchObject({
      newImageAllowed: true,
      featuredImageUrl: "https://img.example.test/a.jpg",
      scenePrompt: "A lamp.",
      sourceVersion: null,
    });
    expect(toDraftBoardView({ ...ready, issuePublished: true }, { now: NOW }).newImageAllowed).toBe(false);
    expect(toDraftBoardView({ ...ready, hasNewerDraft: true }, { now: NOW }).newImageAllowed).toBe(false);
    expect(toDraftBoardView({ ...ready, status: "running" }, { now: NOW }).newImageAllowed).toBe(false);
    expect(toDraftBoardView({ ...ready, status: "failed" }, { now: NOW }).newImageAllowed).toBe(false);
    expect(toDraftBoardView({ ...ready, sourceDraftId: 6, sourceVersion: 1 }, { now: NOW })).toMatchObject({ newImageAllowed: true, sourceVersion: 1 });
  });

  it("allows Retry on a draft whose job never started, once it has waited 5 minutes", () => {
    const waiting = view({ queuedAt: new Date(NOW.getTime() - 60_000) });
    const neverStarted = view({ queuedAt: new Date(NOW.getTime() - NEVER_STARTED_AFTER_MS - 1) });

    expect(toDraftBoardView(waiting, { now: NOW }).retryable).toBe(false);
    expect(toDraftBoardView(neverStarted, { now: NOW }).retryable).toBe(true);
  });
});

describe("readDraftForBoard", () => {
  it("returns null for a missing draft", async () => {
    await expect(readDraftForBoard(99, NOW)).resolves.toBeNull();
  });

  it("names the unread stories, in the draft's order", async () => {
    const issue = (await fakeDb.client.issue.create({ data: { title: "t", issueDate: DAY } })) as { id: bigint };
    await fakeDb.client.story.create({ data: { id: 11, headline: "Second unread", url: "https://example.test/11" } });
    await fakeDb.client.story.create({ data: { id: 12, headline: "First unread", url: null } });
    const draft = (await fakeDb.client.issueDraft.create({
      data: { issueId: issue.id, version: 1, outlineId: 1n, status: "ready", html: "<p>x</p>", unreadStoryIds: [12, 11, 13] },
    })) as { id: bigint };

    const board = await readDraftForBoard(Number(draft.id), NOW);

    expect(board?.unreadStories).toEqual([
      { id: 12, headline: "First unread", url: null },
      { id: 11, headline: "Second unread", url: "https://example.test/11" },
      { id: 13, headline: "Story 13", url: null },
    ]);
    expect(board).toMatchObject({ status: "ready", hasHtml: true, issueDate: "2027-01-04" });
  });
});

describe("listDraftsForBoard", () => {
  it("lists the date's drafts, newest first, with subject, status, GHL link, sent and current", async () => {
    const issue = (await fakeDb.client.issue.create({ data: { title: "t", issueDate: DAY } })) as { id: bigint };
    const v1 = (await fakeDb.client.issueDraft.create({
      data: { issueId: issue.id, version: 1, outlineId: 1n, status: "ready", content: { title: "First Take" }, ghlTemplateId: "tpl-1" },
    })) as { id: bigint };
    await fakeDb.client.issueDraft.create({
      data: { issueId: issue.id, version: 2, outlineId: 2n, status: "failed", failedStep: "image", error: "No image." },
    });
    await fakeDb.client.publishEvent.create({ data: { draftId: v1.id } });

    const drafts = await listDraftsForBoard("2027-01-04");

    expect(drafts.map((draft) => [draft.version, draft.status, draft.sent, draft.current])).toEqual([
      [2, "failed", false, false],
      [1, "ready", true, true],
    ]);
    expect(drafts[0]).toMatchObject({ failedStepLabel: "making the image", subject: null, sourceVersion: null });
    expect(drafts[1]).toMatchObject({ subject: "First Take", ghlTemplateId: "tpl-1", createdAt: expect.any(String) });
  });

  it("says which draft a new image draft came from", async () => {
    const issue = (await fakeDb.client.issue.create({ data: { title: "t", issueDate: DAY } })) as { id: bigint };
    const v1 = (await fakeDb.client.issueDraft.create({
      data: { issueId: issue.id, version: 1, outlineId: 1n, status: "ready", content: { title: "First Take" } },
    })) as { id: bigint };
    await fakeDb.client.issueDraft.create({ data: { issueId: issue.id, version: 2, outlineId: 1n, sourceDraftId: v1.id } });

    const drafts = await listDraftsForBoard("2027-01-04");

    expect(drafts.map((draft) => [draft.version, draft.sourceVersion])).toEqual([
      [2, 1],
      [1, null],
    ]);
  });
});
