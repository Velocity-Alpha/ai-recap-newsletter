import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const repositoryFns = vi.hoisted(() => ({
  fetchPublishedIssueOnOrBeforeDate: vi.fn(),
}));

vi.mock("@/src/features/newsletter/repository", () => repositoryFns);

import { POST } from "@/app/api/newsletters/commit/route";

describe("POST /api/newsletters/commit", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    repositoryFns.fetchPublishedIssueOnOrBeforeDate.mockResolvedValue({
      target_date: "2026-05-21",
      has_exact_match: false,
      issue: null,
    });
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.N8N_WEBHOOK_JWT_SECRET = "n8n-webhook-jwt-secret";
    process.env.OUTLINE_COMMIT_WEBHOOK_URL =
      "https://n8n.velocityalpha.com/webhook/story/approval";
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
        body: JSON.stringify({ date: "2026-05-21", selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(repositoryFns.fetchPublishedIssueOnOrBeforeDate).toHaveBeenCalledWith("2026-05-21");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://n8n.velocityalpha.com/webhook/story/approval",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ date: "2026-05-21", selected_story_ids: [1] }),
      })
    );
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("blocks commit when an issue already exists for the same date", async () => {
    const token = await createApprovalSessionToken("approval-secret");
    repositoryFns.fetchPublishedIssueOnOrBeforeDate.mockResolvedValue({
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
        body: JSON.stringify({ date: "2026-05-21", selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toContain("already published");
  });
});
