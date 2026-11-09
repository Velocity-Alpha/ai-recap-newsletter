import { beforeEach, describe, expect, it, vi } from "vitest";

import { DraftOwnerError, IssuePublishedError, NewImageError } from "@/src/pipeline/draft/draft-store";
import { createApprovalSessionToken } from "@/src/server/approval-auth";

const newImage = vi.hoisted(() => ({ chooseNewImage: vi.fn() }));
vi.mock("@/src/pipeline/draft/new-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/new-image")>()),
  ...newImage,
}));

import { POST } from "@/app/api/approval/drafts/[id]/image/route";
import { NewImageConfigError, NewImageInputError } from "@/src/pipeline/draft/new-image";

const SITE = "https://deploy-preview-9--ai-recap.netlify.app";
const IMAGE = { imageUrl: "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-05-21-abc123.jpg", scenePrompt: "A lamp." };
const DRAFT = { draftId: 42, issueId: 3, version: 3, issueDate: "2026-05-21" };

async function useImage(id: string, body: unknown, signedIn = true) {
  const token = await createApprovalSessionToken("approval-secret");
  const response = await POST(
    new Request(`${SITE}/api/approval/drafts/${id}/image`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(signedIn ? { Cookie: `approval_session=${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, json: await response.json() };
}

describe("POST /api/approval/drafts/[id]/image (Use this image)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    newImage.chooseNewImage.mockResolvedValue({ draft: DRAFT, start: { started: true } });
  });

  it("needs the approval login, and makes no draft without it", async () => {
    const { response } = await useImage("41", IMAGE, false);

    expect(response.status).toBe(401);
    expect(newImage.chooseNewImage).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a number", async () => {
    const { response } = await useImage("-1", IMAGE);

    expect(response.status).toBe(400);
    expect(newImage.chooseNewImage).not.toHaveBeenCalled();
  });

  it("makes the next draft from this one and starts its job on this deploy", async () => {
    const { response, json } = await useImage("41", IMAGE);

    expect(response.status).toBe(200);
    expect(newImage.chooseNewImage).toHaveBeenCalledWith(41, IMAGE, { siteUrl: SITE });
    expect(json).toEqual({ success: true, draft: DRAFT });
  });

  it("answers 502 with the new draft when its job does not start (the draft is failed, with Retry)", async () => {
    newImage.chooseNewImage.mockResolvedValue({ draft: DRAFT, start: { started: false, error: "Starting the draft job failed with HTTP 500." } });

    const { response, json } = await useImage("41", IMAGE);

    expect(response.status).toBe(502);
    expect(json).toEqual({ success: false, error: "Starting the draft job failed with HTTP 500.", draft: DRAFT });
  });

  it.each([
    [400, new NewImageInputError('"https://elsewhere.example.test/a.jpg" is not an image this site uploaded for 2026-05-21.')],
    [404, new NewImageError("Draft 41 does not exist.", "missing")],
    [409, new NewImageError("Draft 41 is failed. Only a ready draft can get a new image.", "not_ready")],
    [409, new IssuePublishedError(3, "2026-05-21")],
    [409, new DraftOwnerError()],
    [409, new NewImageError('Draft v1 is not the newest draft: v2 is running. Use "New image" on the newest ready draft.', "not_current")],
    [500, new NewImageConfigError("S3_BUCKET is not set on this deploy, so the chosen image cannot be checked.")],
  ])("answers %i with the plain reason", async (status, error) => {
    newImage.chooseNewImage.mockRejectedValue(error);

    const { response, json } = await useImage("41", IMAGE);

    expect(response.status).toBe(status);
    expect(json).toEqual({ success: false, error: error.message });
  });

  it("answers 500 without details for anything else", async () => {
    newImage.chooseNewImage.mockRejectedValue(new Error("boom"));

    const { response, json } = await useImage("41", IMAGE);

    expect(response.status).toBe(500);
    expect(json).toEqual({ success: false, error: "Could not make the new draft." });
  });
});
