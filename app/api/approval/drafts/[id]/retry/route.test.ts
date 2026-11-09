import { beforeEach, describe, expect, it, vi } from "vitest";

import { DraftNotRetryableError, IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { createApprovalSessionToken } from "@/src/server/approval-auth";

const nativeCommit = vi.hoisted(() => ({ retryNativeDraft: vi.fn() }));
vi.mock("@/src/pipeline/draft/native-commit", () => nativeCommit);

const outlineStore = vi.hoisted(() => ({ readDraftOwner: vi.fn() }));
vi.mock("@/src/pipeline/draft/outline-store", () => outlineStore);

import { POST } from "@/app/api/approval/drafts/[id]/retry/route";

const DRAFT = { draftId: 41, issueId: 3, version: 2, issueDate: "2026-05-21" };

async function retry(id: string, signedIn = true) {
  const token = await createApprovalSessionToken();
  const response = await POST(
    new Request(`https://deploy-preview-9--ai-recap.netlify.app/api/approval/drafts/${id}/retry`, {
      method: "POST",
      headers: signedIn ? { Cookie: `approval_session=${token}` } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, json: await response.json() };
}

describe("POST /api/approval/drafts/[id]/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    outlineStore.readDraftOwner.mockResolvedValue("native");
    nativeCommit.retryNativeDraft.mockResolvedValue({ draft: DRAFT, start: { started: true } });
  });

  it("needs the approval login", async () => {
    const { response } = await retry("41", false);

    expect(response.status).toBe(401);
    expect(nativeCommit.retryNativeDraft).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a number", async () => {
    const { response } = await retry("4.5");

    expect(response.status).toBe(400);
    expect(nativeCommit.retryNativeDraft).not.toHaveBeenCalled();
  });

  it("runs the draft again and starts its job on this deploy", async () => {
    const { response, json } = await retry("41");

    expect(response.status).toBe(200);
    expect(nativeCommit.retryNativeDraft).toHaveBeenCalledWith(41, { siteUrl: "https://deploy-preview-9--ai-recap.netlify.app" });
    expect(json).toEqual({ success: true, draft: DRAFT });
  });

  it("refuses while n8n drafts", async () => {
    outlineStore.readDraftOwner.mockResolvedValue("n8n");

    const { response, json } = await retry("41");

    expect(response.status).toBe(409);
    expect(json.error).toContain("draft.owner is n8n");
    expect(nativeCommit.retryNativeDraft).not.toHaveBeenCalled();
  });

  it.each([
    ["a draft that is not failed", new DraftNotRetryableError("Draft 41 is running now.")],
    ["a published issue", new IssuePublishedError(3, "2026-05-21")],
  ])("refuses %s with 409", async (_name, error) => {
    nativeCommit.retryNativeDraft.mockRejectedValue(error);

    const { response, json } = await retry("41");

    expect(response.status).toBe(409);
    expect(json).toEqual({ success: false, error: error.message });
  });

  it("answers 502 when the job does not start (the draft is failed again)", async () => {
    nativeCommit.retryNativeDraft.mockResolvedValue({
      draft: DRAFT,
      start: { started: false, error: "Starting the draft job failed with HTTP 500." },
    });

    const { response, json } = await retry("41");

    expect(response.status).toBe(502);
    expect(json).toEqual({ success: false, error: "Starting the draft job failed with HTTP 500.", draft: DRAFT });
  });
});
