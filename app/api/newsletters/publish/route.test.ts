import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

import { POST } from "@/app/api/newsletters/publish/route";

describe("POST /api/newsletters/publish", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.JWT_SECRET = "jwt-secret";
    process.env.DRAFT_PUBLISH_WEBHOOK_URL =
      "https://n8n.velocityalpha.com/webhook/story/approval";
  });

  it("rejects requests without an approval session", async () => {
    const response = await POST(
      new Request("http://localhost/api/newsletters/publish", {
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

  it("forwards authenticated publish payloads to the configured webhook", async () => {
    const token = await createApprovalSessionToken("approval-secret");
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ accepted: true }),
    });

    const response = await POST(
      new Request("http://localhost/api/newsletters/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `approval_session=${token}`,
        },
        body: JSON.stringify({ selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://n8n.velocityalpha.com/webhook/story/approval",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ selected_story_ids: [1] }),
      })
    );
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });
});
