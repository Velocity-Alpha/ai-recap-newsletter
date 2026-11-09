import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const repositoryFns = vi.hoisted(() => ({
  fetchLastPublishedIssueDateOnOrBefore: vi.fn(),
}));

vi.mock("@/src/features/newsletter/repository", () => repositoryFns);

const outlineStore = vi.hoisted(() => ({
  readDraftOwner: vi.fn(),
  saveOutline: vi.fn(),
}));

vi.mock("@/src/pipeline/draft/outline-store", () => outlineStore);

const draftStore = vi.hoisted(() => ({
  createDraft: vi.fn(),
  markDraftStartFailed: vi.fn(),
}));

vi.mock("@/src/pipeline/draft/draft-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/draft-store")>()),
  ...draftStore,
}));

const storyChanges = vi.hoisted(() => ({ applyStoryChanges: vi.fn() }));

vi.mock("@/src/pipeline/draft/story-changes", () => storyChanges);

import { POST } from "@/app/api/newsletters/commit/route";
import { IssuePublishedError } from "@/src/pipeline/draft/draft-store";

describe("POST /api/newsletters/commit", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({
      target_date: "2026-05-21",
      has_exact_match: false,
      issue: null,
    });
    outlineStore.readDraftOwner.mockResolvedValue("n8n");
    outlineStore.saveOutline.mockResolvedValue({ id: BigInt(5), hash: "a".repeat(64) });
    draftStore.createDraft.mockResolvedValue({ draftId: 41, issueId: 3, version: 2, issueDate: "2026-05-21" });
    draftStore.markDraftStartFailed.mockResolvedValue(true);
    storyChanges.applyStoryChanges.mockResolvedValue({ excluded: 1, queued: 2, edited: 1 });
    process.env.SESSION_SECRET = "s".repeat(32);
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.N8N_WEBHOOK_JWT_SECRET = "n8n-webhook-jwt-secret";
    process.env.APP_ENV = "production";
    process.env.OUTLINE_COMMIT_WEBHOOK_URL =
      "https://n8n.velocityalpha.com/webhook/story/approval";
  });

  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.OUTLINE_COMMIT_WEBHOOK_URL;
  });

  async function commit(body: unknown) {
    const token = await createApprovalSessionToken("approval-secret");
    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `approval_session=${token}` },
        body: JSON.stringify(body),
      }),
    );
    return { response, json: await response.json() };
  }

  function webhookAccepts() {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ accepted: true }) });
  }

  it("uses the production n8n webhook by default in production", async () => {
    delete process.env.OUTLINE_COMMIT_WEBHOOK_URL;
    webhookAccepts();

    const { response } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://n8n.velocityalpha.com/webhook/story/approval", expect.anything());
  });

  it.each(["preview", "development"])("refuses to commit in %s when no webhook is set", async (appEnv) => {
    process.env.APP_ENV = appEnv;
    delete process.env.OUTLINE_COMMIT_WEBHOOK_URL;

    const { response, json } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] });

    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.error).toContain("OUTLINE_COMMIT_WEBHOOK_URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the production webhook outside production", async () => {
    process.env.APP_ENV = "preview";
    process.env.OUTLINE_COMMIT_WEBHOOK_URL = "https://n8n.velocityalpha.com/webhook/story/approval/";

    const { response, json } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] });

    expect(response.status).toBe(503);
    expect(json.error).toContain("production n8n webhook");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards to a non-production webhook outside production", async () => {
    process.env.APP_ENV = "preview";
    process.env.OUTLINE_COMMIT_WEBHOOK_URL = "https://n8n.velocityalpha.com/webhook-test/story/approval";
    webhookAccepts();

    const { response } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://n8n.velocityalpha.com/webhook-test/story/approval",
      expect.anything(),
    );
  });

  it("forwards only the normalised YYYY-MM-DD date", async () => {
    webhookAccepts();

    await commit({ date: "2026-05-21T23:30:00-05:00", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] });

    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).toHaveBeenCalledWith("2026-05-21");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      date: "2026-05-21",
      approved_ids_by_section: { top_stories: [1] },
      selected_story_ids: [1],
    });
  });

  it.each(["05/21/2026", "2026-02-30", "2026-5-21", 20260521])("rejects the date %j", async (date) => {
    const { response, json } = await commit({ date, selected_story_ids: [1] });

    expect(response.status).toBe(400);
    expect(json.error).toContain("missing a valid date");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects requests without an approval session", async () => {
    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized.");
  });

  it("commits authenticated outline payloads to the configured webhook", async () => {
    const token = await createApprovalSessionToken("approval-secret");
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ accepted: true }),
    });

    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `approval_session=${token}`,
        },
        body: JSON.stringify({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).toHaveBeenCalledWith("2026-05-21");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://n8n.velocityalpha.com/webhook/story/approval",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] }),
      })
    );
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("blocks commit when an issue already exists for the same date", async () => {
    const token = await createApprovalSessionToken("approval-secret");
    repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({
      target_date: "2026-05-21",
      has_exact_match: true,
      issue: {
        id: "42",
        slug: "existing-issue",
        title: "Already Published",
        issue_date: "2026-05-21T00:00:00.000Z",
        published_at: "2026-05-21T13:00:00.000Z",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `approval_session=${token}`,
        },
        body: JSON.stringify({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toContain("already published");
  });

  it("returns 400 when commit payload is missing a date", async () => {
    const token = await createApprovalSessionToken("approval-secret");

    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `approval_session=${token}`,
        },
        body: JSON.stringify({ selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain("missing a valid date");
    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when commit payload contains an invalid date", async () => {
    const token = await createApprovalSessionToken("approval-secret");

    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `approval_session=${token}`,
        },
        body: JSON.stringify({ date: "not-a-date", selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain("missing a valid date");
    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("saves the normalised outline with draft owner n8n before forwarding", async () => {
    webhookAccepts();
    const body = {
      date: "2026-05-21",
      approved_ids_by_section: { top_stories: [3, 1] },
      newsletter_headline: 3,
      excluded_stories: [{ id: 9, reason: "off topic", newsletter_category: "top_stories", headline: "x" }],
      stories: [{ id: 3, url: "https://example.com/edited", note: "n", newsletter_category: "top_stories" }],
      candidate_map: { "3": { id: 3 } },
    };

    const { response } = await commit(body);

    expect(response.status).toBe(200);
    expect(outlineStore.saveOutline).toHaveBeenCalledWith(
      {
        date: "2026-05-21",
        sections: [{ key: "top_stories", storyIds: [3, 1] }],
        leadStoryId: 3,
        stories: [{ id: 3, section: "top_stories", url: "https://example.com/edited", note: "n" }],
        excluded: [{ id: 9, section: "top_stories", reason: "off topic" }],
      },
      "n8n",
    );
    expect(outlineStore.saveOutline.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    // n8n still receives the board's body (with the normalised date).
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
  });

  it("leaves drafts and stories to n8n while draft.owner is n8n", async () => {
    webhookAccepts();

    await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, excluded_stories: [{ id: 9 }] });

    expect(storyChanges.applyStoryChanges).not.toHaveBeenCalled();
    expect(draftStore.createDraft).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://n8n.velocityalpha.com/webhook/story/approval");
  });

  describe("while draft.owner is native", () => {
    const BACKGROUND_URL = "http://localhost/.netlify/functions/draft-issue-background";
    const BODY = {
      date: "2026-05-21",
      approved_ids_by_section: { top_stories: [3, 1] },
      newsletter_headline: 3,
      excluded_stories: [{ id: 9, reason: "off topic", newsletter_category: "top_stories" }],
      stories: [{ id: 3, url: "https://example.com/edited", note: "n", newsletter_category: "top_stories" }],
    };
    const OUTLINE = {
      date: "2026-05-21",
      sections: [{ key: "top_stories", storyIds: [3, 1] }],
      leadStoryId: 3,
      stories: [{ id: 3, section: "top_stories", url: "https://example.com/edited", note: "n" }],
      excluded: [{ id: 9, section: "top_stories", reason: "off topic" }],
    };

    beforeEach(() => {
      outlineStore.readDraftOwner.mockResolvedValue("native");
      fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    });

    it("saves the outline as native, applies the story changes, creates the draft, and starts its job", async () => {
      const { response, json } = await commit(BODY);

      expect(response.status).toBe(200);
      expect(json).toMatchObject({
        success: true,
        owner: "native",
        draft: { draftId: 41, issueId: 3, version: 2, issueDate: "2026-05-21" },
      });
      expect(outlineStore.saveOutline).toHaveBeenCalledWith(OUTLINE, "native");
      expect(storyChanges.applyStoryChanges).toHaveBeenCalledWith(OUTLINE);
      expect(draftStore.createDraft).toHaveBeenCalledWith(BigInt(5));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(BACKGROUND_URL);
      expect(JSON.parse(init.body)).toEqual({ draftId: 41 });
      expect(draftStore.markDraftStartFailed).not.toHaveBeenCalled();
    });

    it("never calls n8n, and needs neither its secret nor its webhook", async () => {
      process.env.APP_ENV = "preview";
      delete process.env.OUTLINE_COMMIT_WEBHOOK_URL;
      delete process.env.N8N_WEBHOOK_JWT_SECRET;

      const { response } = await commit(BODY);

      expect(response.status).toBe(200);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([BACKGROUND_URL]);
    });

    it("refuses a published date before saving anything", async () => {
      repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({ target_date: "2026-05-21", has_exact_match: true, issue: null });

      const { response, json } = await commit(BODY);

      expect(response.status).toBe(409);
      expect(json.error).toContain("already published");
      expect(outlineStore.saveOutline).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses with 409 when the issue was published while committing", async () => {
      draftStore.createDraft.mockRejectedValue(new IssuePublishedError(3, "2026-05-21"));

      const { response, json } = await commit(BODY);

      expect(response.status).toBe(409);
      expect(json).toMatchObject({
        success: false,
        error: "The issue for 2026-05-21 (id 3) is already published. Drafting stopped.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("marks the draft failed and returns it when its job does not start", async () => {
      fetchMock.mockResolvedValue(new Response("down", { status: 500 }));

      const { response, json } = await commit(BODY);

      expect(draftStore.markDraftStartFailed).toHaveBeenCalledWith(41, "Starting the draft job failed with HTTP 500.", expect.any(Date));
      expect(response.status).toBe(502);
      expect(json).toMatchObject({
        success: false,
        owner: "native",
        error: "Starting the draft job failed with HTTP 500.",
        draft: { draftId: 41, version: 2 },
      });
    });

    it("rejects an outline with no approved stories", async () => {
      const { response } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [] } });

      expect(response.status).toBe(400);
      expect(outlineStore.saveOutline).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("rejects an outline with no approved stories", async () => {
    const { response, json } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [] } });

    expect(response.status).toBe(400);
    expect(json.error).toContain("no approved stories");
    expect(outlineStore.saveOutline).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
