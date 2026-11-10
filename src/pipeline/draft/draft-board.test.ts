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
const STEP_COUNT = 7;

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
    unreadStoryIds: [],
    createdAt: new Date("2027-01-04T14:58:00.000Z"),
    queuedAt: new Date("2027-01-04T14:58:00.000Z"),
    startedAt: null,
    finishedAt: null,
    featuredImageUrl: null,
    scenePrompt: null,
    editedAt: null,
    issuePublished: false,
    hasNewerDraft: false,
    ...data,
  };
}

function states(data: Partial<DraftView>) {
  return Object.fromEntries(draftSteps(view(data)).map((step) => [step.key, step.state]));
}

async function seedIssue(): Promise<bigint> {
  const issue = (await fakeDb.client.issue.create({ data: { title: "t", issueDate: DAY } })) as { id: bigint };
  return issue.id;
}

async function seedDraft(issueId: bigint, data: Record<string, unknown> = {}): Promise<number> {
  const draft = (await fakeDb.client.issueDraft.create({
    data: { issueId, version: 1, outlineId: 1n, status: "ready", content: { title: "First Take" }, html: "<p>x</p>", ...data },
  })) as { id: bigint };
  return Number(draft.id);
}

beforeEach(() => fakeDb.reset());

describe("draftSteps", () => {
  it("lists every step of the job, in order, with plain labels, and no GHL step", () => {
    expect(draftSteps(view()).map((step) => [step.key, step.label])).toEqual([
      ["load", "loading the outline"],
      ["read_articles", "reading articles"],
      ["write", "writing"],
      ["validate", "checking the writing"],
      ["image", "making the image"],
      ["html", "building the email"],
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
      save: "waiting",
    });
    expect(Object.values(states({}))).toEqual(Array(STEP_COUNT).fill("waiting"));
  });

  it("marks the failed step, and every step done when ready", () => {
    expect(states({ status: "failed", failedStep: "write" })).toMatchObject({ read_articles: "done", write: "failed", validate: "waiting" });
    expect(Object.values(states({ status: "ready" }))).toEqual(Array(STEP_COUNT).fill("done"));
    expect(Object.values(states({ status: "failed", failedStep: DRAFT_START_STEP }))).toEqual(Array(STEP_COUNT).fill("waiting"));
  });
});

describe("draftStepLabel", () => {
  it("names the job's steps and the start of the job", () => {
    expect(draftStepLabel("html")).toBe("building the email");
    expect(draftStepLabel(DRAFT_START_STEP)).toBe("starting the draft job");
    expect(draftStepLabel("something_new")).toBe("something_new");
    expect(draftStepLabel(null)).toBeNull();
  });
});

describe("toDraftBoardView", () => {
  it("gives the board labels, dates as text, and whether Retry is allowed", () => {
    const board = toDraftBoardView(view({ status: "failed", failedStep: "image", error: "Vertex returned no image.", finishedAt: NOW }), {
      now: NOW,
    });

    expect(board).toMatchObject({
      id: 7,
      version: 2,
      status: "failed",
      failedStepLabel: "making the image",
      error: "Vertex returned no image.",
      retryable: true,
      finishedAt: NOW.toISOString(),
      createdAt: "2027-01-04T14:58:00.000Z",
      unreadStories: [],
    });
  });

  it("carries no distribution service fields of its own, and no source draft", () => {
    const board = toDraftBoardView(view({ status: "ready" }), { now: NOW });

    for (const gone of ["ghlTemplateId", "ghlPreviewUrl", "sourceVersion", "newImageAllowed"]) {
      expect(board).not.toHaveProperty(gone);
    }
  });

  it("allows Retry on a draft stuck in running, like retryDraft", () => {
    const fresh = view({ currentStep: "write", startedAt: new Date(NOW.getTime() - 60_000) });
    const stuck = view({ currentStep: "write", startedAt: new Date(NOW.getTime() - STUCK_AFTER_MS - 1) });

    expect(toDraftBoardView(fresh, { now: NOW })).toMatchObject({ retryable: false, stepLabel: "writing" });
    expect(toDraftBoardView(stuck, { now: NOW }).retryable).toBe(true);
    expect(toDraftBoardView(view({ status: "ready" }), { now: NOW }).retryable).toBe(false);
  });

  it("makes only the current draft editable: ready, the newest draft, and the issue not published (#149)", () => {
    const ready = view({ status: "ready", hasHtml: true, featuredImageUrl: "https://img.example.test/a.jpg", scenePrompt: "A lamp." });

    expect(toDraftBoardView(ready, { now: NOW })).toMatchObject({
      editable: true,
      issuePublished: false,
      hasNewerDraft: false,
      featuredImageUrl: "https://img.example.test/a.jpg",
      scenePrompt: "A lamp.",
    });
    expect(toDraftBoardView({ ...ready, status: "running" }, { now: NOW }).editable).toBe(false);
    expect(toDraftBoardView({ ...ready, status: "failed" }, { now: NOW }).editable).toBe(false);
  });

  it("says why a ready draft is not editable: the issue is published, or a newer draft exists", () => {
    const ready = view({ status: "ready", hasHtml: true });

    expect(toDraftBoardView({ ...ready, issuePublished: true }, { now: NOW })).toMatchObject({
      editable: false,
      issuePublished: true,
      hasNewerDraft: false,
    });
    expect(toDraftBoardView({ ...ready, hasNewerDraft: true }, { now: NOW })).toMatchObject({
      editable: false,
      issuePublished: false,
      hasNewerDraft: true,
    });
  });

  it("gives the time of the owner's last change as text, or null for a draft as the job made it", () => {
    const changed = new Date("2027-01-04T14:59:30.000Z");

    expect(toDraftBoardView(view({ status: "ready" }), { now: NOW }).editedAt).toBeNull();
    expect(toDraftBoardView(view({ status: "ready", editedAt: changed }), { now: NOW }).editedAt).toBe("2027-01-04T14:59:30.000Z");
  });

  it("passes on the issue's newest staged version, and null when nothing is staged", () => {
    const staged = { version: 3, stagedAt: "2027-01-04T14:59:00.000Z", serviceName: "GHL", serviceUrl: "https://preview.example.test/v3" };

    expect(toDraftBoardView(view({ status: "ready" }), { now: NOW }).staged).toBeNull();
    expect(toDraftBoardView(view({ status: "ready" }), { now: NOW, staged: null }).staged).toBeNull();
    expect(toDraftBoardView(view({ status: "ready" }), { now: NOW, staged }).staged).toEqual(staged);
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
    const issueId = await seedIssue();
    await fakeDb.client.story.create({ data: { id: 11, headline: "Second unread", url: "https://example.test/11" } });
    await fakeDb.client.story.create({ data: { id: 12, headline: "First unread", url: null } });
    const draftId = await seedDraft(issueId, { unreadStoryIds: [12, 11, 13] });

    const board = await readDraftForBoard(draftId, NOW);

    expect(board?.unreadStories).toEqual([
      { id: 12, headline: "First unread", url: null },
      { id: 11, headline: "Second unread", url: "https://example.test/11" },
      { id: 13, headline: "Story 13", url: null },
    ]);
    expect(board).toMatchObject({ status: "ready", hasHtml: true, issueDate: "2027-01-04" });
  });

  it("reads the current draft as editable, with nothing staged and no change yet", async () => {
    const draftId = await seedDraft(await seedIssue());

    await expect(readDraftForBoard(draftId, NOW)).resolves.toMatchObject({
      subject: "First Take",
      editable: true,
      issuePublished: false,
      hasNewerDraft: false,
      editedAt: null,
      staged: null,
    });
  });

  it("gives the time of the owner's last title or image change", async () => {
    const draftId = await seedDraft(await seedIssue(), { editedAt: new Date("2027-01-04T14:59:30.000Z") });

    expect((await readDraftForBoard(draftId, NOW))?.editedAt).toBe("2027-01-04T14:59:30.000Z");
  });

  it.each(["running", "ready", "failed"])("stops a draft being editable once a newer draft exists, even a %s one", async (newerStatus) => {
    const issueId = await seedIssue();
    const older = await seedDraft(issueId);
    const newer = await seedDraft(issueId, { version: 2, status: newerStatus });

    await expect(readDraftForBoard(older, NOW)).resolves.toMatchObject({ status: "ready", hasNewerDraft: true, editable: false });
    await expect(readDraftForBoard(newer, NOW)).resolves.toMatchObject({ hasNewerDraft: false, editable: newerStatus === "ready" });
  });

  it("does not count another issue's drafts as newer", async () => {
    const draftId = await seedDraft(await seedIssue());
    const other = (await fakeDb.client.issue.create({ data: { title: "u", issueDate: new Date("2027-01-05T00:00:00.000Z") } })) as { id: bigint };
    await seedDraft(other.id, { version: 2 });

    await expect(readDraftForBoard(draftId, NOW)).resolves.toMatchObject({ hasNewerDraft: false, editable: true });
  });

  it("stops a draft being editable once its issue is published", async () => {
    const issue = (await fakeDb.client.issue.create({ data: { title: "t", issueDate: DAY, publishedAt: NOW } })) as { id: bigint };
    const draftId = await seedDraft(issue.id);

    await expect(readDraftForBoard(draftId, NOW)).resolves.toMatchObject({ issuePublished: true, hasNewerDraft: false, editable: false });
  });

  describe("the staged version", () => {
    const stagedRow = (issueId: bigint, data: Record<string, unknown> = {}) =>
      fakeDb.client.stagedVersion.create({
        data: {
          issueId,
          version: 1,
          status: "staged",
          service: "ghl",
          serviceUrl: "https://preview.example.test/v1",
          stagedAt: new Date("2027-01-04T14:30:00.000Z"),
          ...data,
        },
      });

    it("gives the issue's newest staged version, with the distribution service's name and link", async () => {
      const issueId = await seedIssue();
      const draftId = await seedDraft(issueId);
      await stagedRow(issueId);
      await stagedRow(issueId, { version: 2, serviceUrl: "https://preview.example.test/v2", stagedAt: new Date("2027-01-04T14:45:00.000Z") });

      expect((await readDraftForBoard(draftId, NOW))?.staged).toEqual({
        version: 2,
        stagedAt: "2027-01-04T14:45:00.000Z",
        serviceName: "GHL",
        serviceUrl: "https://preview.example.test/v2",
      });
    });

    it("gives a null link when the distribution service returned none", async () => {
      const issueId = await seedIssue();
      const draftId = await seedDraft(issueId);
      await stagedRow(issueId, { serviceUrl: null });

      expect((await readDraftForBoard(draftId, NOW))?.staged).toMatchObject({ version: 1, serviceName: "GHL", serviceUrl: null });
    });

    it("ignores a staged version that is still staging", async () => {
      const issueId = await seedIssue();
      const draftId = await seedDraft(issueId);
      await stagedRow(issueId);
      await stagedRow(issueId, { version: 2, status: "staging", serviceUrl: null, stagedAt: null });

      expect((await readDraftForBoard(draftId, NOW))?.staged).toMatchObject({ version: 1, serviceUrl: "https://preview.example.test/v1" });
    });

    it("is null when the issue's only staged version is still staging", async () => {
      const issueId = await seedIssue();
      const draftId = await seedDraft(issueId);
      await stagedRow(issueId, { status: "staging", serviceUrl: null, stagedAt: null });

      expect((await readDraftForBoard(draftId, NOW))?.staged).toBeNull();
    });

    it("ignores another issue's staged versions", async () => {
      const draftId = await seedDraft(await seedIssue());
      const other = (await fakeDb.client.issue.create({ data: { title: "u", issueDate: new Date("2027-01-05T00:00:00.000Z") } })) as { id: bigint };
      await stagedRow(other.id, { version: 4 });

      expect((await readDraftForBoard(draftId, NOW))?.staged).toBeNull();
    });

    it("shows it on an older draft of the issue too", async () => {
      const issueId = await seedIssue();
      const older = await seedDraft(issueId);
      await seedDraft(issueId, { version: 2 });
      await stagedRow(issueId);

      await expect(readDraftForBoard(older, NOW)).resolves.toMatchObject({ editable: false, staged: { version: 1, serviceName: "GHL" } });
    });
  });
});

describe("listDraftsForBoard", () => {
  it("lists the date's drafts, newest first, with subject, status, sent and current", async () => {
    const issueId = await seedIssue();
    const v1 = await seedDraft(issueId);
    await fakeDb.client.issueDraft.create({
      data: { issueId, version: 2, outlineId: 2n, status: "failed", failedStep: "image", error: "No image." },
    });
    await fakeDb.client.publishEvent.create({ data: { draftId: BigInt(v1) } });

    const drafts = await listDraftsForBoard("2027-01-04");

    expect(drafts.map((draft) => [draft.version, draft.status, draft.sent, draft.current])).toEqual([
      [2, "failed", false, false],
      [1, "ready", true, true],
    ]);
    expect(drafts[0]).toMatchObject({ failedStepLabel: "making the image", subject: null });
    expect(drafts[1]).toMatchObject({ subject: "First Take", failedStepLabel: null, createdAt: expect.any(String) });
  });

  it("gives each entry only what the list shows: no distribution service fields, no source draft", async () => {
    await seedDraft(await seedIssue());

    const [entry] = await listDraftsForBoard("2027-01-04");

    expect(Object.keys(entry).sort()).toEqual(["createdAt", "current", "failedStepLabel", "id", "sent", "status", "subject", "version"]);
  });
});
