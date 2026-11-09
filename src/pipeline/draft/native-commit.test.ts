import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});

import { DraftNotRetryableError, IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";
import { commitNativeDraft, DRAFT_START_STEP, retryNativeDraft } from "@/src/pipeline/draft/native-commit";
import { readDraftJobRequest } from "@/src/pipeline/draft/start-draft";

const SECRET = "s".repeat(32);
const NOW = new Date("2027-01-04T15:00:00.000Z");
const SITE = { siteUrl: "https://deploy-preview-9--ai-recap.netlify.app" };
const OUTLINE = { ...SAMPLE_OUTLINE, date: "2027-01-04" };

function accepted() {
  return vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
}

function options(fetch: typeof globalThis.fetch, env: Record<string, string | undefined> = { SESSION_SECRET: SECRET }) {
  return { env, now: () => NOW, fetch };
}

function draftRow(id: number) {
  return fakeDb.state.drafts.rows.find((row) => Number(row.id) === id);
}

beforeEach(() => fakeDb.reset());

describe("commitNativeDraft", () => {
  it("saves the outline as native, creates draft v1, and starts its job", async () => {
    const fetch = accepted();

    const result = await commitNativeDraft(OUTLINE, SITE, options(fetch));

    expect(fakeDb.state.outlines.rows).toHaveLength(1);
    expect(fakeDb.state.outlines.rows[0]).toMatchObject({ draftOwner: "native", payload: OUTLINE });
    expect(result.draft).toMatchObject({ version: 1, issueDate: "2027-01-04" });
    expect(draftRow(result.draft.draftId)).toMatchObject({ status: "running", outlineId: fakeDb.state.outlines.rows[0].id });
    expect(result.start).toEqual({ started: true });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://deploy-preview-9--ai-recap.netlify.app/.netlify/functions/draft-issue-background");
    await expect(readDraftJobRequest(new Request(url, init), { SESSION_SECRET: SECRET }, NOW)).resolves.toBe(result.draft.draftId);
  });

  it("applies the story changes before the draft exists", async () => {
    for (const id of [501, 502, 509]) {
      await fakeDb.client.story.create({ data: { id, url: `https://example.test/${id}`, note: null, excludeFromCandidates: false } });
    }
    const outline = { ...OUTLINE, excluded: [{ id: 509, section: "tools", reason: "old" }] };

    const result = await commitNativeDraft(outline, SITE, options(accepted()));

    const story = (id: number) => fakeDb.state.stories.rows.find((row) => Number(row.id) === id);
    expect(story(509)).toMatchObject({ excludeFromCandidates: true });
    expect(story(501)).toMatchObject({ queuedForPublicationDate: new Date("2027-01-04T00:00:00.000Z") });
    expect(result.storyChanges).toMatchObject({ excluded: 1 });
  });

  it("makes the next version on a second commit for the date", async () => {
    await commitNativeDraft(OUTLINE, SITE, options(accepted()));
    const second = await commitNativeDraft(OUTLINE, SITE, options(accepted()));

    expect(second.draft.version).toBe(2);
    expect(fakeDb.state.issues.rows).toHaveLength(1);
  });

  it("marks the draft failed at the start step, in plain words, when the job does not start", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("nope", { status: 404 }));

    const result = await commitNativeDraft(OUTLINE, SITE, options(fetch));

    expect(result.start).toEqual({ started: false, error: "Starting the draft job failed with HTTP 404." });
    expect(draftRow(result.draft.draftId)).toMatchObject({
      status: "failed",
      failedStep: DRAFT_START_STEP,
      error: "Starting the draft job failed with HTTP 404.",
      finishedAt: NOW,
    });
  });

  it("marks the draft failed when the job cannot be started at all", async () => {
    const fetch = accepted();
    const unreachable = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError("fetch failed");
    });

    const noSecret = await commitNativeDraft(OUTLINE, SITE, options(fetch, {}));
    const offline = await commitNativeDraft(OUTLINE, SITE, options(unreachable));

    expect(fetch).not.toHaveBeenCalled();
    expect(noSecret.start).toEqual({ started: false, error: "Could not start the draft job. Missing setting: SESSION_SECRET." });
    expect(offline.start).toEqual({ started: false, error: "Could not start the draft job: fetch failed" });
    expect(draftRow(offline.draft.draftId)).toMatchObject({ status: "failed", failedStep: DRAFT_START_STEP });
  });

  it("leaves a draft the job already took, even if the start call then failed", async () => {
    const slow = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const { draftId } = JSON.parse(String(init?.body)) as { draftId: number };
      await fakeDb.client.issueDraft.updateMany({ where: { id: BigInt(draftId) }, data: { startedAt: NOW, currentStep: "load" } });
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });

    const result = await commitNativeDraft(OUTLINE, SITE, options(slow));

    expect(result.start.started).toBe(false);
    expect(draftRow(result.draft.draftId)).toMatchObject({ status: "running", failedStep: null, error: null });
  });

  it("refuses a published date and starts nothing", async () => {
    await fakeDb.client.issue.create({ data: { title: "Sent", issueDate: new Date("2027-01-04T00:00:00.000Z"), publishedAt: NOW } });
    const fetch = accepted();

    await expect(commitNativeDraft(OUTLINE, SITE, options(fetch))).rejects.toBeInstanceOf(IssuePublishedError);

    expect(fakeDb.state.drafts.rows).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("retryNativeDraft", () => {
  it("runs a failed draft again from the start", async () => {
    const failed = await commitNativeDraft(OUTLINE, SITE, options(vi.fn(async () => new Response(null, { status: 500 }))));
    const fetch = accepted();

    const result = await retryNativeDraft(failed.draft.draftId, SITE, options(fetch));

    expect(result.draft).toEqual(failed.draft);
    expect(result.start).toEqual({ started: true });
    expect(draftRow(failed.draft.draftId)).toMatchObject({ status: "running", failedStep: null, error: null, startedAt: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("marks the retried draft failed again when its job does not start", async () => {
    const failed = await commitNativeDraft(OUTLINE, SITE, options(vi.fn(async () => new Response(null, { status: 500 }))));

    const result = await retryNativeDraft(failed.draft.draftId, SITE, options(vi.fn(async () => new Response(null, { status: 503 }))));

    expect(result.start).toEqual({ started: false, error: "Starting the draft job failed with HTTP 503." });
    expect(draftRow(failed.draft.draftId)).toMatchObject({ status: "failed", failedStep: DRAFT_START_STEP });
  });

  it("refuses a draft that is still running, and starts nothing", async () => {
    const running = await commitNativeDraft(OUTLINE, SITE, options(accepted()));
    const fetch = accepted();

    await expect(retryNativeDraft(running.draft.draftId, SITE, options(fetch))).rejects.toBeInstanceOf(DraftNotRetryableError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
