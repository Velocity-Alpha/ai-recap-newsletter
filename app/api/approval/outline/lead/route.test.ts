import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const leadPickFns = vi.hoisted(() => ({ checkLeadPickStatus: vi.fn() }));
vi.mock("@/src/features/newsletter/openai-lead-pick", () => leadPickFns);

import { GET } from "@/app/api/approval/outline/lead/route";

function makeRequest(params: Record<string, string>, token?: string) {
  const url = new URL("http://localhost/api/approval/outline/lead");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), { headers: token ? { Cookie: `approval_session=${token}` } : {} });
}

describe("GET /api/approval/outline/lead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
  });

  it("rejects unauthenticated requests and a missing response_id", async () => {
    expect((await GET(makeRequest({ response_id: "resp_lead" }))).status).toBe(401);

    const token = await createApprovalSessionToken();
    expect((await GET(makeRequest({}, token))).status).toBe(400);
    expect(leadPickFns.checkLeadPickStatus).not.toHaveBeenCalled();
  });

  it("reports a pending pick as processing", async () => {
    leadPickFns.checkLeadPickStatus.mockResolvedValue({ status: "pending" });
    const token = await createApprovalSessionToken();

    const json = await (await GET(makeRequest({ response_id: "resp_lead" }, token))).json();
    expect(json).toEqual({ status: "processing" });
  });

  it("returns the picked lead and its reason", async () => {
    leadPickFns.checkLeadPickStatus.mockResolvedValue({
      status: "completed",
      result: { lead_story_id: 7, reason: "A once-in-a-lifetime IPO." },
    });
    const token = await createApprovalSessionToken();

    const json = await (await GET(makeRequest({ response_id: "resp_lead" }, token))).json();
    expect(leadPickFns.checkLeadPickStatus).toHaveBeenCalledWith("resp_lead");
    expect(json).toEqual({ status: "completed", lead_id: 7, reason: "A once-in-a-lifetime IPO." });
  });

  it("reports a failed or unreachable pick as an error, so the board keeps the scored lead", async () => {
    const token = await createApprovalSessionToken();

    leadPickFns.checkLeadPickStatus.mockResolvedValueOnce({ status: "failed", error: "boom" });
    expect(await (await GET(makeRequest({ response_id: "resp_lead" }, token))).json()).toEqual({
      status: "error",
      error: "boom",
    });

    leadPickFns.checkLeadPickStatus.mockRejectedValueOnce(new Error("OpenAI unreachable"));
    expect(await (await GET(makeRequest({ response_id: "resp_lead" }, token))).json()).toEqual({
      status: "error",
      error: "Failed to check the lead pick.",
    });
  });
});
