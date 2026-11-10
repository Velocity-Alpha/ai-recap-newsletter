import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuePublishedError, NewImageError } from "@/src/pipeline/draft/draft-store";
import { createApprovalSessionToken } from "@/src/server/approval-auth";
import { RATE_LIMITS } from "@/src/server/rate-limit";
import type { RateLimitStore } from "@/src/server/rate-limit-store";

const limits = vi.hoisted(() => ({ store: null as RateLimitStore | null }));
vi.mock("@/src/server/rate-limit-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/server/rate-limit-store")>()),
  getRateLimitStore: () => limits.store,
}));

const newImage = vi.hoisted(() => ({ suggestIdeasForDraft: vi.fn() }));
vi.mock("@/src/pipeline/draft/new-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/new-image")>()),
  ...newImage,
}));

import { POST } from "@/app/api/approval/drafts/[id]/image/ideas/route";
import { NewImageServiceError } from "@/src/pipeline/draft/new-image";
import { createMemoryRateLimitStore } from "@/src/server/rate-limit-store";

const IDEAS = [{ label: "Lighthouse", scene: "A pretend lighthouse on a rock." }];

async function ideas(id: string, signedIn = true, session?: string) {
  const token = session ?? (await createApprovalSessionToken());
  const response = await POST(
    new Request(`https://deploy-preview-9--ai-recap.netlify.app/api/approval/drafts/${id}/image/ideas`, {
      method: "POST",
      headers: signedIn ? { Cookie: `approval_session=${token}` } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, json: await response.json() };
}

describe("POST /api/approval/drafts/[id]/image/ideas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limits.store = createMemoryRateLimitStore();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    newImage.suggestIdeasForDraft.mockResolvedValue(IDEAS);
  });

  it("needs the approval login", async () => {
    const { response } = await ideas("41", false);

    expect(response.status).toBe(401);
    expect(newImage.suggestIdeasForDraft).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a number", async () => {
    const { response } = await ideas("abc");

    expect(response.status).toBe(400);
    expect(newImage.suggestIdeasForDraft).not.toHaveBeenCalled();
  });

  it("returns the draft's scene ideas", async () => {
    const { response, json } = await ideas("41");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(newImage.suggestIdeasForDraft).toHaveBeenCalledWith(41);
    expect(json).toEqual({ ideas: IDEAS });
  });

  it.each([
    [404, new NewImageError("Draft 41 does not exist.", "missing")],
    [409, new NewImageError("Draft 41 is running. Only a ready draft can get a new image.", "not_ready")],
    [409, new IssuePublishedError(3, "2026-05-21")],
    [502, new NewImageServiceError("Scene ideas failed: Request timed out.")],
  ])("answers %i with the plain reason", async (status, error) => {
    newImage.suggestIdeasForDraft.mockRejectedValue(error);

    const { response, json } = await ideas("41");

    expect(response.status).toBe(status);
    expect(json).toEqual({ error: error.message });
  });

  it("answers 500 without details for anything else", async () => {
    newImage.suggestIdeasForDraft.mockRejectedValue(new Error("connection string leaked here"));

    const { response, json } = await ideas("41");

    expect(response.status).toBe(500);
    expect(json).toEqual({ error: "Could not suggest scene ideas." });
  });

  it(`allows ${RATE_LIMITS.approvalImageIdeas.limit} idea requests per session in an hour`, async () => {
    const session = await createApprovalSessionToken();
    for (let i = 0; i < RATE_LIMITS.approvalImageIdeas.limit; i++) {
      const { response } = await ideas("41", true, session);
      expect(response.status).toBe(200);
    }
    expect(newImage.suggestIdeasForDraft).toHaveBeenCalledTimes(RATE_LIMITS.approvalImageIdeas.limit);
  });

  it("answers 429 in plain words past the limit, without a model call", async () => {
    const session = await createApprovalSessionToken();
    for (let i = 0; i < RATE_LIMITS.approvalImageIdeas.limit; i++) await ideas("41", true, session);
    newImage.suggestIdeasForDraft.mockClear();

    const { response, json } = await ideas("41", true, session);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(json.error).toMatch(/^Too many scene idea requests this hour\. Try again in about (a minute|\d+ minutes)\.$/);
    expect(newImage.suggestIdeasForDraft).not.toHaveBeenCalled();

    const other = await ideas("41");
    expect(other.response.status).toBe(200);
  });
});
