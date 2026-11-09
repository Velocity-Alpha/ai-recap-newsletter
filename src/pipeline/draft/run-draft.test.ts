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

import { toIssueContentJson, type WrittenIssueContent } from "@/src/pipeline/draft/content";
import { SAMPLE_APPROVED, SAMPLE_CONTENT, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import { createDraft, createImageDraft, retryDraft } from "@/src/pipeline/draft/draft-store";
import { emailImageUrl } from "@/src/pipeline/draft/email-html";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";
import { DRAFT_STEPS, NEW_IMAGE_STEPS, readNoArticles, type ProduceDraftDeps } from "@/src/pipeline/draft/produce-draft";
import { draftsLink, runDraftJob } from "@/src/pipeline/draft/run-draft";
import { finishRun, startRun } from "@/src/pipeline/runs";

const DATE = SAMPLE_OUTLINE.date;
const NOW = new Date("2027-01-04T15:00:00.000Z");
const IMAGE_URL = "https://assets.example.test/newsletter-dev/2027-01-04-abc.jpg";
const DRAFTS_LINK = `https://airecap.news/approval/drafts?date=${DATE}`;
const ENV = { APP_ENV: "development" };

function deps(overrides: Partial<ProduceDraftDeps> = {}): Partial<ProduceDraftDeps> {
  return {
    writer: vi.fn(async () => structuredClone(SAMPLE_CONTENT)),
    makeImage: vi.fn(async () => ({ imageUrl: IMAGE_URL, scenePrompt: "A pretend robot folds towels." })),
    createTemplate: vi.fn(async () => ({ templateId: "tpl-1", previewUrl: "https://preview.example.test/tpl-1", mode: "sent" as const })),
    ...overrides,
  };
}

async function commit(): Promise<{ draftId: number; issueId: number; version: number }> {
  const outline = await fakeDb.client.approvalOutline.create({
    data: { issueDate: new Date(`${DATE}T00:00:00.000Z`), payload: SAMPLE_OUTLINE, payloadHash: "h", draftOwner: "native" },
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
  settings.set("draft.owner", "native");
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
      ghlTemplateId: "tpl-1",
      ghlPreviewUrl: "https://preview.example.test/tpl-1",
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
    expect(runLog.events.map((event) => event.step)).toEqual(["load", ...DRAFT_STEPS, "save"]);
    expect(runLog.finished).toEqual([
      expect.objectContaining({ status: "succeeded", stats: expect.objectContaining({ draftId, version: 1, issue: "updated" }) }),
    ]);
    expect(notify.resolveIncident).toHaveBeenCalledWith(`draft.failed:${DATE}`, expect.objectContaining({ runId: BigInt(7) }));
    expect(notify.raiseIncident).not.toHaveBeenCalled();
  });

  const writerFailure = () => Promise.reject(new Error("The writer refused: no."));
  const failures: Array<[string, Partial<ProduceDraftDeps>, string]> = [
    ["read_articles", { readArticles: vi.fn(async () => Promise.reject(new Error("Reader timed out."))) }, "Reader timed out."],
    ["write", { writer: vi.fn(writerFailure) }, "The writer refused: no."],
    ["validate", { writer: vi.fn(async (): Promise<WrittenIssueContent> => ({ ...SAMPLE_CONTENT, title: "Short" })) }, "The title has 1 word"],
    ["image", { makeImage: vi.fn(async () => Promise.reject(new Error("Vertex returned HTTP 429."))) }, "Vertex returned HTTP 429."],
    ["ghl", { createTemplate: vi.fn(async () => Promise.reject(new Error("GHL create template failed with HTTP 401."))) }, "HTTP 401"],
  ];

  it.each(failures)("marks the draft failed at %s, leaves the issue alone, and raises a critical incident", async (step, overrides, message) => {
    const { draftId, issueId } = await commit();

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps(overrides) });

    expect(result).toMatchObject({ status: "failed", draftId, runId: "7", step });
    expect(draftRow(draftId)).toMatchObject({ status: "failed", failedStep: step, currentStep: null, finishedAt: NOW });
    expect(draftRow(draftId).error).toContain(message);
    expect(issueRow(issueId)).toMatchObject({ title: `AI Recap draft ${DATE}`, html: null, contentJson: null });
    expect(runLog.finished).toEqual([expect.objectContaining({ status: "failed" })]);
    expect(runLog.events.at(-1)).toMatchObject({ level: "error", step });
    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentKey: `draft.failed:${DATE}`,
        severity: "critical",
        what: expect.stringContaining(`Draft v1 for ${DATE} failed`),
        evidence: expect.stringContaining(message),
        link: DRAFTS_LINK,
      }),
      expect.objectContaining({ runId: BigInt(7) }),
    );
    expect(notify.resolveIncident).not.toHaveBeenCalled();
  });

  it("keeps the written content on a draft that failed its checks", async () => {
    const { draftId } = await commit();
    const short = { ...SAMPLE_CONTENT, title: "Short" };

    await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps({ writer: vi.fn(async () => structuredClone(short)) }) });

    expect(draftRow(draftId)).toMatchObject({ status: "failed", failedStep: "validate", content: short });
  });

  it("fails at load when a story in the outline is missing", async () => {
    fakeDb.state.stories.rows = fakeDb.state.stories.rows.filter((row) => Number(row.id) !== 507);
    const { draftId } = await commit();

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toMatchObject({ status: "failed", step: "load", error: "Story 507 is in the outline but not in the database." });
    expect(draftRow(draftId)).toMatchObject({ status: "failed", failedStep: "load" });
  });

  it("fails at load when n8n took drafting back after the commit", async () => {
    const { draftId } = await commit();
    settings.set("draft.owner", "n8n");

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toMatchObject({ status: "failed", step: "load" });
    expect(draftRow(draftId).error).toContain("draft.owner");
  });

  it("stops at load when the issue was published after the commit", async () => {
    const { draftId, issueId } = await commit();
    await fakeDb.client.issue.update({ where: { id: BigInt(issueId) }, data: { publishedAt: NOW, title: "Sent issue" } });

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toMatchObject({ status: "failed", step: "load", error: expect.stringContaining("already published") });
    expect(issueRow(issueId)).toMatchObject({ title: "Sent issue", html: null });
  });

  it("fails at save, with nothing half-written, when the issue row cannot take the title", async () => {
    const { draftId, issueId } = await commit();
    fakeDb.state.issueUpdateError = Object.assign(new Error("Unique constraint failed on the fields: (`slug`)"), { code: "P2002" });

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: deps() });

    expect(result).toMatchObject({ status: "failed", step: "save" });
    // The GHL template exists, so the failed draft keeps its link.
    expect(draftRow(draftId)).toMatchObject({ status: "failed", failedStep: "save", ghlTemplateId: "tpl-1" });
    expect(draftRow(draftId).error).toContain(`Another issue already uses the title "${SAMPLE_CONTENT.title}"`);
    expect(issueRow(issueId)).toMatchObject({ html: null });
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
    expect(second.createTemplate).toHaveBeenCalledWith(expect.objectContaining({ version }));
    expect(notify.resolveIncident).toHaveBeenCalledWith(`draft.failed:${DATE}`, expect.anything());
  });

  it("records GHL calls outside production in the run log, without the HTML", async () => {
    const { draftId } = await commit();
    // No createTemplate: the job's own GHL step runs, which is a dry run outside production.
    const rest = deps();
    delete rest.createTemplate;

    const result = await runDraftJob(draftId, { env: ENV, now: () => NOW, deps: rest });

    expect(result).toMatchObject({ status: "ready" });
    expect(draftRow(draftId).ghlTemplateId).toBe(`dry-run-${DATE}-v1`);
    const recorded = runLog.events.filter((event) => event.step === "ghl" && event.data);
    expect(recorded.map((event) => (event.data as { action: string }).action)).toEqual(["createTemplate", "setTemplateHtml"]);
    expect(JSON.stringify(recorded)).not.toContain("<html");
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

describe("runDraftJob for a new image (#116)", () => {
  const IMAGE_ENV = { APP_ENV: "development", S3_BUCKET: "example-bucket" };
  const NEW_IMAGE = {
    imageUrl: `https://example-bucket.s3.amazonaws.com/newsletter-dev/${DATE}-def456.jpg`,
    scenePrompt: "A pretend lighthouse on a rock.",
  };
  // The image step's HEAD request to S3: the chosen file is there, as a JPEG.
  const s3Head = vi.fn<typeof fetch>(async () => new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } }));
  beforeEach(() => s3Head.mockClear());

  async function readyV1() {
    const v1 = await commit();
    await runDraftJob(v1.draftId, { env: IMAGE_ENV, fetch: s3Head, now: () => NOW, deps: deps() });
    expect(draftRow(v1.draftId).status).toBe("ready");
    fakeDb.state.drafts.updates.length = 0;
    runLog.events.length = 0;
    runLog.finished.length = 0;
    notify.raiseIncident.mockClear();
    notify.resolveIncident.mockClear();
    return { v1, v1Row: structuredClone(draftRow(v1.draftId)) };
  }

  const tpl2 = () => vi.fn(async () => ({ templateId: "tpl-2", previewUrl: "https://preview.example.test/tpl-2", mode: "sent" as const }));

  it("copies the source's content, runs only image, html, and GHL, and makes a new GHL template", async () => {
    const { v1, v1Row } = await readyV1();
    const v2 = await createImageDraft(v1.draftId, NEW_IMAGE, { now: () => NOW });
    const second = deps({ createTemplate: tpl2() });

    const result = await runDraftJob(v2.draftId, { env: IMAGE_ENV, fetch: s3Head, now: () => NOW, deps: second });

    expect(result).toEqual({ status: "ready", draftId: v2.draftId, runId: "7", issue: "updated" });
    expect(stepHistory()).toEqual(["load", ...NEW_IMAGE_STEPS, "save", null]);
    expect(runLog.events.map((event) => event.step)).toEqual(["load", ...NEW_IMAGE_STEPS, "save"]);
    expect(second.writer).not.toHaveBeenCalled();
    expect(second.makeImage).not.toHaveBeenCalled();
    expect(s3Head).toHaveBeenCalledWith(NEW_IMAGE.imageUrl, expect.objectContaining({ method: "HEAD" }));
    expect(second.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ issueDate: DATE, version: 2, subject: SAMPLE_CONTENT.title }),
    );
    expect(draftRow(v2.draftId)).toMatchObject({
      version: 2,
      status: "ready",
      content: v1Row.content,
      unreadStoryIds: v1Row.unreadStoryIds,
      featuredImageUrl: NEW_IMAGE.imageUrl,
      scenePrompt: NEW_IMAGE.scenePrompt,
      ghlTemplateId: "tpl-2",
    });
    expect(draftRow(v2.draftId).html).toContain(`data-draft-id="${v2.draftId}"`);
    expect(draftRow(v2.draftId).html).toContain(NEW_IMAGE.imageUrl);
    // v1 and its GHL template stay as they were (ADR 0002).
    expect(draftRow(v1.draftId)).toEqual(v1Row);
    expect(runLog.finished).toEqual([
      expect.objectContaining({ status: "succeeded", stats: expect.objectContaining({ sourceDraftId: v1.draftId, version: 2 }) }),
    ]);
  });

  it("puts the new image on the unpublished issue, with the same title and text", async () => {
    const { v1 } = await readyV1();
    const v2 = await createImageDraft(v1.draftId, NEW_IMAGE, { now: () => NOW });

    await runDraftJob(v2.draftId, { env: IMAGE_ENV, fetch: s3Head, now: () => NOW, deps: deps({ createTemplate: tpl2() }) });

    expect(issueRow(v1.issueId)).toMatchObject({
      title: SAMPLE_CONTENT.title,
      excerpt: SAMPLE_CONTENT.excerpt,
      html: draftRow(v2.draftId).html,
      featureImageUrl: NEW_IMAGE.imageUrl,
      promptFeaturedImage: NEW_IMAGE.scenePrompt,
      contentJson: toIssueContentJson(SAMPLE_CONTENT, { issueId: v1.issueId, issueDate: DATE, featuredImageUrl: emailImageUrl(NEW_IMAGE.imageUrl) }),
      publishedAt: null,
    });
  });

  it("fails at image when the chosen image is not one this site uploaded, and the issue keeps v1", async () => {
    const { v1 } = await readyV1();
    const issueBefore = structuredClone(issueRow(v1.issueId));
    const v2 = await createImageDraft(v1.draftId, { ...NEW_IMAGE, imageUrl: "https://elsewhere.example.test/picture.jpg" }, { now: () => NOW });
    const second = deps({ createTemplate: tpl2() });

    const result = await runDraftJob(v2.draftId, { env: IMAGE_ENV, fetch: s3Head, now: () => NOW, deps: second });

    expect(result).toMatchObject({ status: "failed", draftId: v2.draftId, step: "image" });
    expect(draftRow(v2.draftId)).toMatchObject({ status: "failed", failedStep: "image" });
    expect(draftRow(v2.draftId).error).toContain("is not an image this site uploaded");
    expect(second.createTemplate).not.toHaveBeenCalled();
    expect(s3Head).not.toHaveBeenCalled();
    expect(issueRow(v1.issueId)).toEqual(issueBefore);
    // v1 is still ready and on the issue, so this is a warning, not a critical incident.
    expect(notify.raiseIncident).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "warning", what: `Draft v2 for ${DATE} failed at making the image.` }),
      expect.anything(),
    );
  });

  it("fails at image when the chosen file is not in S3", async () => {
    const { v1 } = await readyV1();
    const v2 = await createImageDraft(v1.draftId, NEW_IMAGE, { now: () => NOW });
    const missing = vi.fn<typeof fetch>(async () => new Response(null, { status: 404, headers: { "content-type": "application/xml" } }));
    const second = deps({ createTemplate: tpl2() });

    const result = await runDraftJob(v2.draftId, { env: IMAGE_ENV, fetch: missing, now: () => NOW, deps: second });

    expect(result).toMatchObject({ status: "failed", step: "image", error: "The chosen image is not in S3 as a JPEG (HTTP 404)." });
    expect(second.createTemplate).not.toHaveBeenCalled();
  });

  it("asks for a new commit when the copied title clashes with another issue, since a retry copies the same title", async () => {
    const { v1 } = await readyV1();
    const v2 = await createImageDraft(v1.draftId, NEW_IMAGE, { now: () => NOW });
    fakeDb.state.issueUpdateError = Object.assign(new Error("Unique constraint failed on the fields: (`slug`)"), { code: "P2002" });

    const result = await runDraftJob(v2.draftId, { env: IMAGE_ENV, fetch: s3Head, now: () => NOW, deps: deps({ createTemplate: tpl2() }) });

    expect(result).toMatchObject({ status: "failed", step: "save" });
    expect(draftRow(v2.draftId).error).toBe(
      `Another issue already uses the title "${SAMPLE_CONTENT.title}", and titles must be unique. Commit again for a new title.`,
    );
  });

  it("retries a failed new image draft with the same image and content, and still writes nothing", async () => {
    const { v1 } = await readyV1();
    const v2 = await createImageDraft(v1.draftId, NEW_IMAGE, { now: () => NOW });
    const ghlDown = vi.fn(async () => Promise.reject(new Error("GHL create template failed with HTTP 502.")));
    await runDraftJob(v2.draftId, { env: IMAGE_ENV, fetch: s3Head, now: () => NOW, deps: deps({ createTemplate: ghlDown }) });
    expect(draftRow(v2.draftId)).toMatchObject({ status: "failed", failedStep: "ghl" });

    await retryDraft(v2.draftId, { now: () => NOW });
    const again = deps({ createTemplate: tpl2() });
    const result = await runDraftJob(v2.draftId, { env: IMAGE_ENV, fetch: s3Head, now: () => NOW, deps: again });

    expect(result).toMatchObject({ status: "ready", draftId: v2.draftId });
    expect(again.writer).not.toHaveBeenCalled();
    expect(stepHistory().filter((step) => step === "write")).toEqual([]);
    expect(stepHistory().filter((step) => step === "image")).toHaveLength(2);
    expect(draftRow(v2.draftId)).toMatchObject({
      version: 2,
      status: "ready",
      content: SAMPLE_CONTENT,
      featuredImageUrl: NEW_IMAGE.imageUrl,
      scenePrompt: NEW_IMAGE.scenePrompt,
      ghlTemplateId: "tpl-2",
    });
  });

  it("stops at load when the issue was published after the image was chosen, and never changes the published issue", async () => {
    const { v1 } = await readyV1();
    const v2 = await createImageDraft(v1.draftId, NEW_IMAGE, { now: () => NOW });
    await fakeDb.client.issue.update({ where: { id: BigInt(v1.issueId) }, data: { publishedAt: NOW } });
    const published = structuredClone(issueRow(v1.issueId));
    const second = deps({ createTemplate: tpl2() });

    const result = await runDraftJob(v2.draftId, { env: IMAGE_ENV, fetch: s3Head, now: () => NOW, deps: second });

    expect(result).toMatchObject({ status: "failed", step: "load", error: expect.stringContaining("already published") });
    expect(second.createTemplate).not.toHaveBeenCalled();
    expect(issueRow(v1.issueId)).toEqual(published);
    await expect(createImageDraft(v1.draftId, NEW_IMAGE)).rejects.toThrow("already published");
  });
});

describe("draftsLink", () => {
  it("uses Netlify's URL in production, the deploy's address on previews, and production otherwise", () => {
    expect(draftsLink(DATE, { APP_ENV: "production", URL: "https://airecap.news/", DEPLOY_PRIME_URL: "https://main--ai-recap.netlify.app" })).toBe(
      `https://airecap.news/approval/drafts?date=${DATE}`,
    );
    expect(draftsLink(DATE, { APP_ENV: "preview", URL: "https://airecap.news", DEPLOY_PRIME_URL: "https://deploy-preview-9--ai-recap.netlify.app" })).toBe(
      `https://deploy-preview-9--ai-recap.netlify.app/approval/drafts?date=${DATE}`,
    );
    expect(draftsLink(DATE, {})).toBe(DRAFTS_LINK);
    expect(draftsLink(DATE, { APP_ENV: "production" })).toBe(DRAFTS_LINK);
  });
});
