import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { createApprovalSessionToken } from "@/src/server/approval-auth";

const staging = vi.hoisted(() => ({ stageDraft: vi.fn() }));
vi.mock("@/src/pipeline/distribution/stage-draft", async (original) => ({
  ...(await original<typeof import("@/src/pipeline/distribution/stage-draft")>()),
  stageDraft: staging.stageDraft,
}));

import { POST } from "@/app/api/approval/drafts/[id]/stage/route";
import { StageError } from "@/src/pipeline/distribution/stage-draft";

const STAGED = {
  id: 93,
  version: 2,
  issueDate: "2026-05-21",
  title: "Pretend Lab Plans A Week",
  service: "ghl",
  serviceName: "GHL",
  serviceRef: "tpl_new",
  serviceUrl: "https://preview.example/tpl_new/index.html",
  mode: "sent",
  stagedAt: "2026-05-21T15:00:00.000Z",
};

async function stage(id: string, options: { body?: unknown; signedIn?: boolean } = {}) {
  const token = await createApprovalSessionToken();
  const response = await POST(
    new Request(`https://airecap.news/api/approval/drafts/${id}/stage`, {
      method: "POST",
      headers: options.signedIn === false ? {} : { Cookie: `approval_session=${token}` },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, json: await response.json() };
}

describe("POST /api/approval/drafts/[id]/stage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    staging.stageDraft.mockResolvedValue(STAGED);
  });

  it("needs the approval login", async () => {
    const { response } = await stage("41", { signedIn: false });

    expect(response.status).toBe(401);
    expect(staging.stageDraft).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a number", async () => {
    const { response } = await stage("4.5");

    expect(response.status).toBe(400);
    expect(staging.stageDraft).not.toHaveBeenCalled();
  });

  it("stages the draft and returns the staged version", async () => {
    const { response, json } = await stage("41");

    expect(response.status).toBe(200);
    expect(staging.stageDraft).toHaveBeenCalledWith(41, { confirmRepeat: false });
    expect(json).toEqual({ success: true, staged: STAGED });
  });

  it("passes the owner's yes to stage an unchanged draft again", async () => {
    await stage("41", { body: { confirmRepeat: true } });

    expect(staging.stageDraft).toHaveBeenCalledWith(41, { confirmRepeat: true });
  });

  it("takes only a real true as the owner's yes", async () => {
    await stage("41", { body: { confirmRepeat: "true" } });

    expect(staging.stageDraft).toHaveBeenCalledWith(41, { confirmRepeat: false });
  });

  it("answers 409 with code already_staged and the version, so the page can ask the owner", async () => {
    staging.stageDraft.mockRejectedValue(new StageError("v2 is already staged, and the draft has not changed since.", "already_staged", 2));

    const { response, json } = await stage("41");

    expect(response.status).toBe(409);
    expect(json).toEqual({ success: false, code: "already_staged", error: "v2 is already staged, and the draft has not changed since.", version: 2 });
  });

  it.each([
    ["missing", 404],
    ["not_current", 409],
    ["not_ready", 409],
    ["staging_running", 409],
    ["service_failed", 502],
  ] as const)("answers a %s refusal with HTTP %i and its message", async (code, status) => {
    staging.stageDraft.mockRejectedValue(new StageError(`Refused: ${code}.`, code));

    const { response, json } = await stage("41");

    expect(response.status).toBe(status);
    expect(json).toEqual({ success: false, code, error: `Refused: ${code}.` });
  });

  it("refuses a published issue with 409", async () => {
    const error = new IssuePublishedError(3, "2026-05-21");
    staging.stageDraft.mockRejectedValue(error);

    const { response, json } = await stage("41");

    expect(response.status).toBe(409);
    expect(json).toEqual({ success: false, code: "published", error: error.message });
  });

  it("answers 500 with a plain message for an unknown error", async () => {
    staging.stageDraft.mockRejectedValue(new Error("connection reset"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { response, json } = await stage("41");

    expect(response.status).toBe(500);
    expect(json).toEqual({ success: false, error: "Could not stage the draft." });
    logged.mockRestore();
  });
});
