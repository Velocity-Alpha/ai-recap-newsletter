import { beforeEach, describe, expect, it, vi } from "vitest";

import { DraftEditError, IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { createApprovalSessionToken } from "@/src/server/approval-auth";
import { RATE_LIMITS } from "@/src/server/rate-limit";
import type { RateLimitStore } from "@/src/server/rate-limit-store";

const limits = vi.hoisted(() => ({ store: null as RateLimitStore | null }));
vi.mock("@/src/server/rate-limit-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/server/rate-limit-store")>()),
  getRateLimitStore: () => limits.store,
}));

const newImage = vi.hoisted(() => ({ writeSceneForDraft: vi.fn() }));
vi.mock("@/src/pipeline/draft/new-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/new-image")>()),
  ...newImage,
}));

import { POST } from "@/app/api/approval/drafts/[id]/image/chat/route";
import { NewImageInputError, NewImageServiceError } from "@/src/pipeline/draft/new-image";
import { createMemoryRateLimitStore } from "@/src/server/rate-limit-store";

const REPLY = { reply: "Done.", scene: "A pretend star and sun in orbit." };
const BODY = { scene: "", messages: [{ role: "owner", text: "A star and a sun circling each other." }] };

async function send(id: string, signedIn = true, session?: string) {
  const token = session ?? (await createApprovalSessionToken());
  const response = await POST(
    new Request(`https://deploy-preview-9--ai-recap.netlify.app/api/approval/drafts/${id}/image/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(signedIn ? { Cookie: `approval_session=${token}` } : {}) },
      body: JSON.stringify(BODY),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, json: await response.json() };
}

describe("POST /api/approval/drafts/[id]/image/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limits.store = createMemoryRateLimitStore();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    newImage.writeSceneForDraft.mockResolvedValue(REPLY);
  });

  it("needs the approval login", async () => {
    const { response } = await send("41", false);

    expect(response.status).toBe(401);
    expect(newImage.writeSceneForDraft).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a number", async () => {
    const { response } = await send("abc");

    expect(response.status).toBe(400);
    expect(newImage.writeSceneForDraft).not.toHaveBeenCalled();
  });

  it("sends the chat to the draft and returns the reply and scene", async () => {
    const { response, json } = await send("41");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(newImage.writeSceneForDraft).toHaveBeenCalledWith(41, BODY);
    expect(json).toEqual(REPLY);
  });

  it.each([
    [404, new DraftEditError("Draft 41 does not exist.", "missing")],
    [409, new DraftEditError("The draft for 2026-05-21 is running. Only a ready draft can be changed.", "not_ready")],
    [409, new DraftEditError("This is not the newest draft for 2026-05-21. Reload the page.", "not_current")],
    [409, new IssuePublishedError(3, "2026-05-21")],
    [400, new NewImageInputError("Describe the picture first.")],
    [502, new NewImageServiceError("Scene chat failed: Request timed out.")],
  ])("answers %i with the plain reason", async (status, error) => {
    newImage.writeSceneForDraft.mockRejectedValue(error);

    const { response, json } = await send("41");

    expect(response.status).toBe(status);
    expect(json).toEqual({ error: error.message });
  });

  it("answers 500 without details for anything else", async () => {
    newImage.writeSceneForDraft.mockRejectedValue(new Error("connection string leaked here"));

    const { response, json } = await send("41");

    expect(response.status).toBe(500);
    expect(json).toEqual({ error: "Could not write the scene." });
  });

  it(`allows ${RATE_LIMITS.approvalSceneChat.limit} scene chat messages per session in an hour`, async () => {
    const session = await createApprovalSessionToken();
    for (let i = 0; i < RATE_LIMITS.approvalSceneChat.limit; i++) {
      const { response } = await send("41", true, session);
      expect(response.status).toBe(200);
    }
    expect(newImage.writeSceneForDraft).toHaveBeenCalledTimes(RATE_LIMITS.approvalSceneChat.limit);
  });

  it("answers 429 in plain words past the limit, without a model call", async () => {
    const session = await createApprovalSessionToken();
    for (let i = 0; i < RATE_LIMITS.approvalSceneChat.limit; i++) await send("41", true, session);
    newImage.writeSceneForDraft.mockClear();

    const { response, json } = await send("41", true, session);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(json.error).toMatch(/^Too many scene chat messages this hour\. Try again in about (a minute|\d+ minutes)\.$/);
    expect(newImage.writeSceneForDraft).not.toHaveBeenCalled();

    const other = await send("41");
    expect(other.response.status).toBe(200);
  });
});
