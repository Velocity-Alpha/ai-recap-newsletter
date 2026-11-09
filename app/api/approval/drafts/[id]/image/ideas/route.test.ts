import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuePublishedError, NewImageError } from "@/src/pipeline/draft/draft-store";
import { createApprovalSessionToken } from "@/src/server/approval-auth";

const newImage = vi.hoisted(() => ({ suggestIdeasForDraft: vi.fn() }));
vi.mock("@/src/pipeline/draft/new-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/new-image")>()),
  ...newImage,
}));

import { POST } from "@/app/api/approval/drafts/[id]/image/ideas/route";
import { NewImageServiceError } from "@/src/pipeline/draft/new-image";

const IDEAS = [{ label: "Lighthouse", scene: "A pretend lighthouse on a rock." }];

async function ideas(id: string, signedIn = true) {
  const token = await createApprovalSessionToken("approval-secret");
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
    process.env.APPROVAL_PASSWORD = "approval-secret";
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
});
