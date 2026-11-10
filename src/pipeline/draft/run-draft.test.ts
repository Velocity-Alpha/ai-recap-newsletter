import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => new Map<string, unknown>());
const runLog = vi.hoisted(() => ({
  events: [] as Array<{ level: string; step: string; message: string; data?: unknown }>,
  finished: [] as Array<{ status: string; stats?: Record<string, unknown>; error?: string }>,
  started: [] as Array<{ job: string; trigger: string }>,
}));
const notify = vi.hoisted(() => ({ raiseIncident: vi.fn(), resolveIncident: vi.fn() }));

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});
vi.mock("@/src/pipeline/settings", () => ({ readSetting: vi.fn(async (key: string) => settings.get(key) ?? null) }));
vi.mock("@/src/pipeline/runs", () => ({
  startRun: vi.fn(async (input: { job: string; trigger: string }) => {
    runLog.started.push(input);
    return BigInt(7);
  }),
  logEvent: vi.fn(async (_runId: bigint, event: (typeof runLog.events)[number]) => {
    runLog.events.push(event);
  }),
  finishRun: vi.fn(async (_runId: bigint, result: (typeof runLog.finished)[number]) => {
    runLog.finished.push(result);
  }),
}));
vi.mock("@/src/pipeline/notify", () => notify);
// The job's own article reader, with a fake web and saved copies in memory.
const articleWeb = vi.hoisted(() => ({ routes: {} as Record<string, unknown> }));
const articleStore = vi.hoisted(() => ({ findRead: vi.fn(), save: vi.fn(), clearOldText: vi.fn() }));
vi.mock("@/src/pipeline/draft/articles/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/pipeline/draft/articles/http")>();
  const { fakeWeb } = await import("@/src/pipeline/draft/articles/fake-web.fixture");
  return { ...actual, createNodeFetch: () => fakeWeb(articleWeb.routes as never).fetch };
});
vi.mock("@/src/pipeline/draft/articles/article-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/articles/article-store")>()),
  prismaArticleStore: articleStore,
}));

import { htmlPage, jinaAnswer, jinaUrl, prose } from "@/src/pipeline/draft/articles/fake-web.fixture";
import { toIssueContentJson, type WrittenIssueContent } from "@/src/pipeline/draft/content";
import { SAMPLE_APPROVED, SAMPLE_CONTENT, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import { createDraft, retryDraft } from "@/src/pipeline/draft/draft-store";
import { emailImageUrl } from "@/src/pipeline/draft/email-html";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";
import { DRAFT_STEPS, readNoArticles, type ProduceDraftDeps } from "@/src/pipeline/draft/produce-draft";
import { buildDraftReadyMessage, DRAFT_STEP_LABELS, runDraftJob } from "@/src/pipeline/draft/run-draft";
import { finishRun, logEvent, startRun } from "@/src/pipeline/runs";

const DATE = SAMPLE_OUTLINE.date;
const NOW = new Date("2027-01-04T15:00:00.000Z");
const IMAGE_URL = "https://assets.example.test/newsletter-dev/2027-01-04-abc.jpg";
const DRAFTS_LINK = `https://airecap.news/approval/drafts?date=${DATE}`;
const ENV = { APP_ENV: "development" };
const PRODUCTION_ENV = { APP_ENV: "production" };
const READY_MESSAGE = `Draft for ${DATE} is ready for review: ${DRAFTS_LINK}`;

function deps(overrides: Partial<ProduceDraftDeps> = {}): Partial<ProduceDraftDeps> {
  return {
    readArticles: vi.fn(readNoArticles),
    writer: vi.fn(async () => structuredClone(SAMPLE_CONTENT)),
    makeImage: vi.fn(async () => ({ imageUrl: IMAGE_URL, scenePrompt: "A pretend robot folds towels." })),
    ...overrides,
  };
}

/** A stand-in for the real Telegram sender. */
function telegramSender() {
  return vi.fn<(text: string) => Promise<void>>(async () => undefined);
}

function telegramEvents() {
  return runLog.events.filter((event) => event.step === "telegram");
}

async function commit(): Promise<{ draftId: number; issueId: number; version: number }> {
  const outline = await fakeDb.client.approvalOutline.create({
    data: { issueDate: new Date(`${DATE}T00:00:00.000Z`), payload: SAMPLE_OUTLINE, payloadHash: "h" },
  });
  return createDraft((outline as { id: bigint }).id);
}

function draftRow(draftId: number) {
  return fakeDb.state.drafts.rows.find((row) => row.id === BigInt(draftId))!;
}

function issueRow(issueId: number) {
  return fakeDb.state.issues.rows.find((row) => row.id === BigInt(issueId))!;
}

function stepHistory(): unknown[] {
  return fakeDb.state.drafts.updates.filter((data) => "currentStep" in data).map((data) => data.currentStep);
}

beforeEach(() => {
  fakeDb.reset();
  settings.clear();
  runLog.events.length = 0;
  runLog.finished.length = 0;
  runLog.started.length = 0;
  notify.raiseIncident.mockReset().mockResolvedValue({ opened: true, alertId: BigInt(1), delivery: "recorded" });
  notify.resolveIncident.mockReset().mockResolvedValue({ resolved: false, delivery: "skipped" });
  for (const story of Object.values(SAMPLE_APPROVED).flat()) {
    fakeDb.state.stories.rows.push({
      id: story.id as unknown as bigint,
      headline: story.headline,
      summary: story.summary,
      storyDetails: story.storyDetails,
      url: story.url,
      note: null,
    });
  }
});

describe("runDraftJob", () => {
  it("drafts the issue: shows each step live, marks the draft ready, copies it to the issue, and resolves the incident", async () => {
    const { draftId, issueId } = await commit();

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toEqual({ status: "ready", draftId, runId: "7", issue: "updated" });
    expect(runLog.started).toEqual([{ job: "draft-issue", trigger: "event" }]);
    expect(stepHistory()).toEqual(["load", ...DRAFT_STEPS, "save", null]);
    expect(draftRow(draftId)).toMatchObject({
      status: "ready",
      currentStep: null,
      failedStep: null,
      error: null,
      content: SAMPLE_CONTENT,
      featuredImageUrl: IMAGE_URL,
      scenePrompt: "A pretend robot folds towels.",
      unreadStoryIds: [501, 502, 503, 504],
      startedAt: NOW,
      finishedAt: NOW,
    });
    expect(draftRow(draftId).html).toContain(`data-draft-id="${draftId}"`);
    expect(issueRow(issueId)).toMatchObject({
      title: SAMPLE_CONTENT.title,
      html: draftRow(draftId).html,
      featureImageUrl: IMAGE_URL,
      promptFeaturedImage: "A pretend robot folds towels.",
      excerpt: SAMPLE_CONTENT.excerpt,
      contentJson: toIssueContentJson(SAMPLE_CONTENT, { issueId, issueDate: DATE, featuredImageUrl: emailImageUrl(IMAGE_URL) }),
      publishedAt: null,
    });
    // The last event is the review group's message, which is only recorded outside production.
    expect(runLog.events.map((event) => event.step)).toEqual(["load", ...DRAFT_STEPS, "save", "telegram"]);
    expect(runLog.finished).toEqual([
      {
        status: "succeeded",
        stats: {
          draftId,
          issueId,
          version: 1,
          issueDate: DATE,
          issue: "updated",
          telegram: "recorded",
          unreadStoryIds: [501, 502, 503, 504],
          stepMs: expect.any(Object),
        },
      },
    ]);
    expect(Object.keys(runLog.finished[0].stats!.stepMs as object)).toEqual(["load", ...DRAFT_STEPS]);
    expect(notify.resolveIncident).toHaveBeenCalledWith(`draft.failed:${DATE}`, expect.objectContaining({ runId: BigInt(7) }));
    expect(notify.raiseIncident).not.toHaveBeenCalled();
  });

  const writerFailure = () => Promise.reject(new Error("The writer refused: no."));
  const failures: Array<[string, Partial<ProduceDraftDeps>, string]> = [
    ["read_articles", { readArticles: vi.fn(async () => Promise.reject(new Error("Reader timed out."))) }, "Reader timed out."],
    ["write", { writer: vi.fn(writerFailure) }, "The writer refused: no."],
    ["validate", { writer: vi.fn(async (): Promise<WrittenIssueContent> => ({ ...SAMPLE_CONTENT, title: "Short" })) }, "The title has 1 word"],
    ["image", { makeImage: vi.fn(async () => Promise.reject(new Error("Vertex returned HTTP 429."))) }, "Vertex returned HTTP 429."],
  ];

  it.each(failures)("marks the draft failed at %s, leaves the issue alone, and raises a critical incident", async (step, overrides, message) => {
    const { draftId, issueId } = await commit();
    const sendTelegram = telegramSender();

    const result = await runDraftJob(draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(overrides), sendTelegram });

    // A failed draft is not ready for review, so the review group hears nothing.
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(telegramEvents()).toEqual([]);

    expect(result).toMatchObject({ status: "failed", draftId, runId: "7", step });
    expect(draftRow(draftId)).toMatchObject({ status: "failed", failedStep: step, currentStep: null, finishedAt: NOW });
    expect(draftRow(draftId).error).toContain(message);
    expect(issueRow(issueId)).toMatchObject({ title: `AI Recap draft ${DATE}`, html: null, contentJson: null });
    expect(runLog.finished).toEqual([
      {
        status: "failed",
        error: expect.stringContaining(message),
        stats: { draftId, version: 1, issueDate: DATE, failedStep: step, stepMs: expect.any(Object) },
      },
    ]);
    expect(runLog.events.at(-1)).toMatchObject({ level: "error", step });
    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentKey: `draft.failed:${DATE}`,
        severity: "critical",
        what: expect.stringContaining(`The draft for ${DATE} failed`),
        evidence: expect.stringContaining(message),
        link: DRAFTS_LINK,
      }),
      expect.objectContaining({ runId: BigInt(7) }),
    );
    expect(notify.resolveIncident).not.toHaveBeenCalled();
  });

  it("reads the feature stories' articles and logs each story's outcome, so the board can say why one was not read", async () => {
    const [planner, laundry] = SAMPLE_APPROVED.headlines;
    const [paperOne, paperTwo] = SAMPLE_APPROVED.research;
    articleWeb.routes = {
      [planner.url]: htmlPage(prose("planner")),
      [laundry.url]: htmlPage("Forbidden", 403),
      [jinaUrl(laundry.url)]: jinaAnswer(laundry.url, "Just a moment..."),
      [paperOne.url]: htmlPage(prose("paper one")),
      [paperTwo.url]: htmlPage(prose("paper two")),
    };
    articleStore.findRead.mockReset().mockRejectedValue(new Error('relation "story_articles" does not exist'));
    articleStore.save.mockReset().mockResolvedValue(undefined);
    articleStore.clearOldText.mockReset().mockResolvedValue(2);
    const { draftId, issueId } = await commit();
    // No readArticles: the job's own reader runs.
    const rest = deps();
    delete rest.readArticles;

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: rest });

    expect(result).toMatchObject({ status: "ready" });
    expect(draftRow(draftId).unreadStoryIds).toEqual([laundry.id]);
    const reads = runLog.events.filter((event) => event.step === "read_articles" && !event.message.startsWith("Started"));
    expect(reads.map(({ level, message }) => ({ level, message }))).toEqual([
      { level: "info", message: "Cleared the saved text of 2 old articles (issue published over 14 days ago, or read over 30 days ago)." },
      { level: "warn", message: 'Could not load saved articles, so every story was read: relation "story_articles" does not exist' },
      { level: "info", message: expect.stringMatching(/^Story 501: read with fetch in [\d.]+ s \([\d,]+ characters\)\.$/) },
      { level: "warn", message: expect.stringMatching(/^Story 502: not read \(blocked\) after [\d.]+ s\. fetch: HTTP 403\. jina: A bot check or block page\.$/) },
      { level: "info", message: expect.stringMatching(/^Story 503: read with fetch/) },
      { level: "info", message: expect.stringMatching(/^Story 504: read with fetch/) },
      { level: "info", message: "Read 3 of 4 articles. Not read: story 502." },
    ]);
    expect(reads[3].data).toMatchObject({ storyId: 502, status: "blocked", method: null, reused: false, attempts: [expect.objectContaining({ method: "fetch", httpStatus: 403 }), expect.objectContaining({ method: "jina" })] });
    expect(JSON.stringify(reads)).not.toContain("planner pretend lab");
    expect(articleStore.save).toHaveBeenCalledTimes(1);
    expect(articleStore.save.mock.calls[0][2]).toEqual({ issueId });
  });

  it("keeps the written content on a draft that failed its checks", async () => {
    const { draftId } = await commit();
    const short = { ...SAMPLE_CONTENT, title: "Short" };

    await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps({ writer: vi.fn(async () => structuredClone(short)) }) });

    expect(draftRow(draftId)).toMatchObject({ status: "failed", failedStep: "validate", content: short });
  });

  it("logs one event for a rewrite, with the problem count and no story text, and saves the rewrite", async () => {
    const { draftId } = await commit();
    const short = { ...SAMPLE_CONTENT, title: "Short" };
    const writer = vi.fn(async () => structuredClone(SAMPLE_CONTENT)).mockImplementationOnce(async () => structuredClone(short));

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps({ writer }) });

    expect(result).toMatchObject({ status: "ready" });
    expect(draftRow(draftId)).toMatchObject({ status: "ready", content: SAMPLE_CONTENT });
    expect(stepHistory()).toEqual(["load", "read_articles", "write", "validate", "write", "validate", "image", "html", "save", null]);
    const rewrites = runLog.events.filter((event) => event.level === "warn");
    expect(rewrites).toEqual([
      { level: "warn", step: "write", message: "The written issue failed 1 check. Writing it once more with the problems listed.", data: { problems: 1 } },
    ]);
    expect(JSON.stringify(runLog.events)).not.toContain("Short");
  });

  it("fails at load when a story in the outline is missing", async () => {
    fakeDb.state.stories.rows = fakeDb.state.stories.rows.filter((row) => Number(row.id) !== 507);
    const { draftId } = await commit();

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toMatchObject({ status: "failed", step: "load", error: "Story 507 is in the outline but not in the database." });
    expect(draftRow(draftId)).toMatchObject({ status: "failed", failedStep: "load" });
  });

  it("stops at load when the issue was published after the commit", async () => {
    const { draftId, issueId } = await commit();
    await fakeDb.client.issue.update({ where: { id: BigInt(issueId) }, data: { publishedAt: NOW, title: "Sent issue" } });

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toMatchObject({ status: "failed", step: "load", error: `The issue for ${DATE} (id ${issueId}) is already published. Drafting stopped.` });
    expect(issueRow(issueId)).toMatchObject({ title: "Sent issue", html: null });
  });

  it("fails at save, with nothing half-written, when the issue row cannot take the title", async () => {
    const { draftId, issueId } = await commit();
    fakeDb.state.issueUpdateError = Object.assign(new Error("Unique constraint failed on the fields: (`slug`)"), { code: "P2002" });

    const sendTelegram = telegramSender();

    const result = await runDraftJob(draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(), sendTelegram });

    const error = `Another issue already uses the title "${SAMPLE_CONTENT.title}", and titles must be unique. Retry to write a new title.`;
    expect(result).toEqual({ status: "failed", draftId, runId: "7", step: "save", error });
    // The failed draft keeps what it made, so the owner can see it.
    expect(draftRow(draftId)).toMatchObject({
      status: "failed",
      failedStep: "save",
      error,
      content: SAMPLE_CONTENT,
      featuredImageUrl: IMAGE_URL,
      scenePrompt: "A pretend robot folds towels.",
    });
    expect(draftRow(draftId).html).toContain(`data-draft-id="${draftId}"`);
    expect(issueRow(issueId)).toMatchObject({ html: null });
    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "critical", what: `The draft for ${DATE} failed at saving the draft.`, evidence: error }),
      expect.anything(),
    );
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("never lets an older draft replace a newer ready one on the issue", async () => {
    const v1 = await commit();
    const v2 = await commit();
    const newer = { ...SAMPLE_CONTENT, title: "Second Pretend Lab Planner Story" };

    await runDraftJob(v2.draftId, { env: ENV, now: () => NOW, deps: deps({ writer: vi.fn(async () => structuredClone(newer)) }) });
    const result = await runDraftJob(v1.draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toMatchObject({ status: "ready", issue: "newer_draft" });
    expect(draftRow(v1.draftId).status).toBe("ready");
    expect(issueRow(v2.issueId).title).toBe(newer.title);
  });

  it("runs a draft once: a second start, or a draft that is not running, does nothing", async () => {
    const { draftId } = await commit();
    const first = deps();
    await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: first });

    const again = deps();
    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: again });

    expect(result).toEqual({ status: "skipped", draftId, reason: `Draft ${draftId} is ready, not waiting to run.` });
    expect(again.writer).not.toHaveBeenCalled();
    expect(runLog.started).toHaveLength(1);
    await expect(runDraftJob(999, { env: ENV, now: () => NOW })).resolves.toEqual({
      status: "skipped",
      draftId: 999,
      reason: "Draft 999 does not exist.",
    });
  });

  it("retries the same draft from the start after a failure", async () => {
    const { draftId, version } = await commit();
    await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps({ writer: vi.fn(writerFailure) }) });
    expect(draftRow(draftId).status).toBe("failed");

    await retryDraft(draftId, { now: () => NOW });
    const second = deps();
    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: second });

    expect(result).toMatchObject({ status: "ready", draftId });
    expect(fakeDb.state.drafts.rows).toHaveLength(1);
    expect(draftRow(draftId)).toMatchObject({ version, status: "ready", failedStep: null, error: null });
    expect(stepHistory().filter((step) => step === "read_articles")).toHaveLength(2);
    expect(second.writer).toHaveBeenCalledTimes(1);
    expect(notify.resolveIncident).toHaveBeenCalledWith(`draft.failed:${DATE}`, expect.anything());
  });

  it("never calls the distribution service: it has no GHL step, even in production with the GHL settings", async () => {
    const { draftId } = await commit();
    const env = { ...PRODUCTION_ENV, GHL_PRIVATE_INTEGRATION_TOKEN: "pit-test-token-0000", GHL_LOCATION_ID: "loc_test", GHL_USER_ID: "user_test" };
    const network = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", network);

    try {
      const result = await runDraftJob(draftId, { env, now: () => NOW, deps: deps(), sendTelegram: telegramSender() });

      expect(result).toMatchObject({ status: "ready", issue: "updated" });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(network).not.toHaveBeenCalled();
    expect(Object.keys(DRAFT_STEP_LABELS)).toEqual(["load", "read_articles", "write", "validate", "image", "html", "save"]);
    expect(stepHistory()).not.toContain("ghl");
    expect(runLog.events.map((event) => event.step)).not.toContain("ghl");
    expect(runLog.finished[0].stats).not.toHaveProperty("ghlMode");
    // Only "Stage for sending" makes a staged version (ADR 0004).
    expect(fakeDb.state.stagedVersions.rows).toEqual([]);
  });

  it("does nothing when another invocation has already claimed the draft", async () => {
    const { draftId } = await commit();
    await fakeDb.client.issueDraft.update({ where: { id: BigInt(draftId) }, data: { startedAt: NOW, currentStep: "write" } });
    const again = deps();

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: again });

    expect(result).toEqual({ status: "skipped", draftId, reason: `Draft ${draftId} is running already.` });
    expect(again.writer).not.toHaveBeenCalled();
    expect(runLog.started).toEqual([]);
    expect(draftRow(draftId)).toMatchObject({ status: "running", currentStep: "write" });
  });

  it("fails the running step at the deadline, before Netlify stops the function", async () => {
    const { draftId, issueId } = await commit();
    const hangs = vi.fn(() => new Promise<WrittenIssueContent>(() => undefined));

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps({ writer: hangs }), deadlineMs: 20 });

    expect(result).toMatchObject({ status: "failed", step: "write", error: expect.stringContaining("timed out after") });
    expect(draftRow(draftId)).toMatchObject({ status: "failed", failedStep: "write" });
    expect(issueRow(issueId).html).toBeNull();
    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: expect.stringContaining("timed out after") }),
      expect.anything(),
    );
  });

  it("fails a hung article read at the deadline and raises the incident", async () => {
    const { draftId } = await commit();
    const hangs = vi.fn(() => new Promise<Awaited<ReturnType<typeof readNoArticles>>>(() => undefined));

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps({ readArticles: hangs }), deadlineMs: 20 });

    expect(result).toMatchObject({ status: "failed", step: "read_articles", error: expect.stringContaining("timed out after") });
    expect(draftRow(draftId)).toMatchObject({ status: "failed", failedStep: "read_articles" });
    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: expect.stringContaining("timed out after") }),
      expect.anything(),
    );
  });

  it("marks the draft failed and raises the incident when the run log cannot start", async () => {
    const { draftId } = await commit();
    vi.mocked(startRun).mockRejectedValueOnce(new Error("pipeline_runs is down"));

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toEqual({ status: "failed", draftId, runId: null, step: "load", error: "pipeline_runs is down" });
    expect(draftRow(draftId)).toMatchObject({ status: "failed", failedStep: "load", error: "pipeline_runs is down" });
    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: "pipeline_runs is down", details: expect.objectContaining({ runId: null }) }),
      expect.objectContaining({ runId: undefined }),
    );
  });

  it("raises the incident even when marking the draft failed and finishing the run both fail", async () => {
    const { draftId } = await commit();
    vi.mocked(finishRun).mockRejectedValueOnce(new Error("run update failed"));
    const writer = vi.fn(async () => {
      // The writer fails, and so does the next write to the draft row (marking it failed).
      fakeDb.state.drafts.rows = fakeDb.state.drafts.rows.map((row) => ({ ...row, id: BigInt(-1) }));
      throw new Error("The writer refused: no.");
    });

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps({ writer }) });

    expect(result).toMatchObject({ status: "failed", step: "write", error: "The writer refused: no." });
    const [incident] = notify.raiseIncident.mock.calls[0] as [{ details: { alsoFailed: string[] } }];
    expect(incident.details.alsoFailed).toEqual([
      expect.stringContaining("Could not mark the draft failed"),
      "Could not finish the run: run update failed",
    ]);
  });

  it("stays ready when only the run log fails after the save", async () => {
    const { draftId } = await commit();
    vi.mocked(finishRun).mockRejectedValueOnce(new Error("run update failed"));

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toMatchObject({ status: "ready" });
    expect(draftRow(draftId).status).toBe("ready");
    expect(runLog.events.at(-1)).toMatchObject({ level: "warn", step: "run", message: "Could not finish the run: run update failed" });
  });

  it("takes the date's lock to save, so drafts finishing together cannot overwrite each other", async () => {
    const { draftId } = await commit();

    await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(fakeDb.state.locks).toEqual([
      ["SELECT pg_advisory_xact_lock(hashtext(?))", `issue-date:${DATE}`],
      ["SELECT pg_advisory_xact_lock(hashtext(?))", `issue-date:${DATE}`],
    ]);
  });

  it("stops at load when another issue row for the date is published", async () => {
    const { draftId, issueId } = await commit();
    await fakeDb.client.issue.create({ data: { title: "An n8n copy", issueDate: new Date(`${DATE}T00:00:00.000Z`), publishedAt: NOW } });

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toMatchObject({ status: "failed", step: "load", error: expect.stringContaining("already published") });
    expect(issueRow(issueId).html).toBeNull();
  });

  it("leaves the issue alone when another issue row for the date is published while it drafts", async () => {
    const { draftId, issueId } = await commit();
    const readArticles = vi.fn(async (stories: Parameters<typeof readNoArticles>[0]) => {
      await fakeDb.client.issue.create({ data: { title: "An n8n copy", issueDate: new Date(`${DATE}T00:00:00.000Z`), publishedAt: NOW } });
      return readNoArticles(stories);
    });

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps({ readArticles }) });

    expect(result).toMatchObject({ status: "ready", issue: "published" });
    expect(issueRow(issueId)).toMatchObject({ title: `AI Recap draft ${DATE}`, html: null });
  });

  it("links the incident to this deploy's board", async () => {
    const { draftId } = await commit();
    const env = { APP_ENV: "preview", DEPLOY_PRIME_URL: "https://deploy-preview-9--ai-recap.netlify.app", URL: "https://airecap.news" };

    await runDraftJob(draftId, { env, now: () => NOW, deps: deps({ writer: vi.fn(writerFailure) }) });

    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({ link: `https://deploy-preview-9--ai-recap.netlify.app/approval/drafts?date=${DATE}` }),
      expect.anything(),
    );
  });

  it("still returns the failure when raising the incident fails", async () => {
    const { draftId } = await commit();
    notify.raiseIncident.mockRejectedValue(new Error("alerts table is down"));

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps({ writer: vi.fn(writerFailure) }) });

    expect(result).toMatchObject({ status: "failed", step: "write" });
    expect(runLog.events.at(-1)).toMatchObject({ level: "warn", step: "alert" });
  });
});

describe("runDraftJob and the review group's message (#149)", () => {
  it("writes the message from the issue date and the drafts page link", () => {
    expect(buildDraftReadyMessage("2027-01-04", "https://airecap.news/approval/drafts?date=2027-01-04")).toBe(
      "Draft for 2027-01-04 is ready for review: https://airecap.news/approval/drafts?date=2027-01-04",
    );
  });

  it("tells the review group in production that the draft is ready, with the link to the drafts page", async () => {
    const { draftId } = await commit();
    const sendTelegram = telegramSender();

    const result = await runDraftJob(draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(), sendTelegram });

    expect(result).toEqual({ status: "ready", draftId, runId: "7", issue: "updated" });
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(sendTelegram).toHaveBeenCalledWith(READY_MESSAGE);
    expect(telegramEvents()).toEqual([{ level: "info", step: "telegram", message: "Sent the ready message." }]);
    expect(runLog.finished[0]).toMatchObject({ status: "succeeded", stats: { issue: "updated", telegram: "sent" } });
    expect(notify.raiseIncident).not.toHaveBeenCalled();
  });

  it("sends the message only after the draft is saved and the issue holds it", async () => {
    const { draftId, issueId } = await commit();
    const seen: Array<{ draft: unknown; issueHtml: unknown; runFinished: number }> = [];
    const sendTelegram = vi.fn(async () => {
      seen.push({ draft: draftRow(draftId).status, issueHtml: issueRow(issueId).html, runFinished: runLog.finished.length });
    });

    await runDraftJob(draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(), sendTelegram });

    // Sent before the run is finished, so the run's stats can say how it went.
    expect(seen).toEqual([{ draft: "ready", issueHtml: draftRow(draftId).html, runFinished: 0 }]);
    expect(runLog.events.map((event) => event.step)).toEqual(["load", ...DRAFT_STEPS, "save", "telegram"]);
  });

  it("links the message to this deploy's site", async () => {
    const { draftId } = await commit();
    const sendTelegram = telegramSender();
    const env = { ...PRODUCTION_ENV, URL: "https://www.example.test/", DEPLOY_PRIME_URL: "https://deploy-preview-9--ai-recap.netlify.app" };

    await runDraftJob(draftId, { env, now: () => NOW, deps: deps(), sendTelegram });

    expect(sendTelegram).toHaveBeenCalledWith(`Draft for ${DATE} is ready for review: https://www.example.test/approval/drafts?date=${DATE}`);
  });

  it.each(["development", "preview", undefined])("records the message in the run log and sends nothing when APP_ENV is %j", async (appEnv) => {
    const { draftId } = await commit();
    const sendTelegram = telegramSender();

    const result = await runDraftJob(draftId, { env: { APP_ENV: appEnv }, now: () => NOW, deps: deps(), sendTelegram });

    expect(result).toMatchObject({ status: "ready", issue: "updated" });
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(telegramEvents()).toEqual([
      { level: "info", step: "telegram", message: "Not sent outside production. Recorded the text.", data: { text: READY_MESSAGE } },
    ]);
    expect(runLog.finished[0].stats).toMatchObject({ telegram: "recorded" });
  });

  it("sends nothing for an older draft that a newer ready one overtook", async () => {
    const v1 = await commit();
    const v2 = await commit();
    const sendTelegram = telegramSender();
    await runDraftJob(v2.draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(), sendTelegram });
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    sendTelegram.mockClear();
    runLog.events.length = 0;
    runLog.finished.length = 0;

    const result = await runDraftJob(v1.draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(), sendTelegram });

    expect(result).toMatchObject({ status: "ready", issue: "newer_draft" });
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(telegramEvents()).toEqual([]);
    expect(runLog.finished[0]).toMatchObject({ status: "succeeded", stats: { issue: "newer_draft", telegram: "skipped" } });
  });

  it.each(["running", "failed"] as const)("sends nothing for v1 when a newer draft exists and is %s: v1 is not the one to review", async (status) => {
    const v1 = await commit();
    const v2 = await commit();
    await fakeDb.client.issueDraft.update({ where: { id: BigInt(v2.draftId) }, data: { status } });
    const sendTelegram = telegramSender();

    const result = await runDraftJob(v1.draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(), sendTelegram });

    // The issue still takes v1, as before: no newer draft is ready.
    expect(result).toMatchObject({ status: "ready", issue: "updated" });
    expect(issueRow(v1.issueId).html).toBe(draftRow(v1.draftId).html);
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(telegramEvents()).toEqual([]);
    expect(runLog.finished[0]).toMatchObject({ status: "succeeded", stats: { issue: "updated", telegram: "skipped" } });
  });

  it("sends the message for v2 when it becomes ready after v1", async () => {
    const v1 = await commit();
    const v2 = await commit();
    const sendTelegram = telegramSender();

    await runDraftJob(v1.draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(), sendTelegram });
    expect(sendTelegram).not.toHaveBeenCalled();
    await runDraftJob(v2.draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(), sendTelegram });

    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(sendTelegram).toHaveBeenCalledWith(READY_MESSAGE);
  });

  it("sends nothing for a draft that finished after the issue was published", async () => {
    const { draftId } = await commit();
    const sendTelegram = telegramSender();
    const readArticles = vi.fn(async (stories: Parameters<typeof readNoArticles>[0]) => {
      await fakeDb.client.issue.create({ data: { title: "An n8n copy", issueDate: new Date(`${DATE}T00:00:00.000Z`), publishedAt: NOW } });
      return readNoArticles(stories);
    });

    const result = await runDraftJob(draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps({ readArticles }), sendTelegram });

    expect(result).toMatchObject({ status: "ready", issue: "published" });
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(telegramEvents()).toEqual([]);
    expect(runLog.finished[0]).toMatchObject({ status: "succeeded", stats: { issue: "published", telegram: "skipped" } });
  });

  it("records nothing outside production either when the issue does not hold the draft", async () => {
    const v1 = await commit();
    const v2 = await commit();
    await runDraftJob(v2.draftId, { env: ENV, now: () => NOW, deps: deps() });
    runLog.events.length = 0;
    runLog.finished.length = 0;

    await runDraftJob(v1.draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(telegramEvents()).toEqual([]);
    expect(runLog.finished[0].stats).toMatchObject({ issue: "newer_draft", telegram: "skipped" });
  });

  it("only warns when the message cannot be sent: the draft stays ready and no incident is raised", async () => {
    const { draftId, issueId } = await commit();
    const sendTelegram = vi.fn(async () => Promise.reject(new Error("Telegram returned HTTP 502.")));

    const result = await runDraftJob(draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(), sendTelegram });

    expect(result).toEqual({ status: "ready", draftId, runId: "7", issue: "updated" });
    expect(draftRow(draftId)).toMatchObject({ status: "ready", failedStep: null, error: null });
    expect(issueRow(issueId).html).toBe(draftRow(draftId).html);
    expect(telegramEvents()).toEqual([{ level: "warn", step: "telegram", message: "Telegram returned HTTP 502." }]);
    expect(runLog.finished).toEqual([expect.objectContaining({ status: "succeeded", stats: expect.objectContaining({ telegram: "failed" }) })]);
    expect(notify.raiseIncident).not.toHaveBeenCalled();
    expect(notify.resolveIncident).toHaveBeenCalledWith(`draft.failed:${DATE}`, expect.objectContaining({ note: "The draft is ready." }));
  });

  it("warns, sends nothing, and stays ready when production has no Telegram bot token", async () => {
    const { draftId } = await commit();

    const result = await runDraftJob(draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps() });

    expect(result).toMatchObject({ status: "ready", issue: "updated" });
    expect(telegramEvents()).toEqual([{ level: "warn", step: "telegram", message: "Missing setting: TELEGRAM_REVIEW_BOT_TOKEN. Not sent." }]);
    expect(runLog.finished[0].stats).toMatchObject({ telegram: "not_configured" });
    expect(notify.raiseIncident).not.toHaveBeenCalled();
  });

  it("stays ready when the run log cannot take the message's event", async () => {
    const { draftId } = await commit();
    const sendTelegram = telegramSender();
    const events = vi.mocked(logEvent);
    const record = events.getMockImplementation()!;
    events.mockImplementation(((runId, event) => {
      if (event.step === "telegram") return Promise.reject(new Error("pipeline_events is down"));
      return record(runId, event);
    }) as typeof logEvent);

    try {
      const result = await runDraftJob(draftId, { env: PRODUCTION_ENV, now: () => NOW, deps: deps(), sendTelegram });

      expect(result).toMatchObject({ status: "ready", issue: "updated" });
    } finally {
      events.mockImplementation(record);
    }

    expect(sendTelegram).toHaveBeenCalledWith(READY_MESSAGE);
    expect(draftRow(draftId).status).toBe("ready");
    expect(runLog.finished[0]).toMatchObject({ status: "succeeded", stats: { telegram: "sent" } });
    expect(notify.raiseIncident).not.toHaveBeenCalled();
  });
});
