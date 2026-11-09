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

import { POST } from "@/app/api/newsletters/commit/route";

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

  it("refuses a commit while draft.owner is native, without saving or calling n8n", async () => {
    outlineStore.readDraftOwner.mockResolvedValue("native");

    const { response, json } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] } });

    expect(response.status).toBe(503);
    expect(json.error).toContain("native drafting is not built yet");
    expect(outlineStore.saveOutline).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an outline with no approved stories", async () => {
    const { response, json } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [] } });

    expect(response.status).toBe(400);
    expect(json.error).toContain("no approved stories");
    expect(outlineStore.saveOutline).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
