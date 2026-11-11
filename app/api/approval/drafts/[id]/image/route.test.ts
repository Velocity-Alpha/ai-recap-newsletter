import { beforeEach, describe, expect, it, vi } from "vitest";

import { DraftEditError, IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { createApprovalSessionToken } from "@/src/server/approval-auth";

const newImage = vi.hoisted(() => ({ chooseNewImage: vi.fn() }));
vi.mock("@/src/pipeline/draft/new-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/new-image")>()),
  ...newImage,
}));

import { POST } from "@/app/api/approval/drafts/[id]/image/route";
import { NewImageConfigError, NewImageInputError, NewImageServiceError } from "@/src/pipeline/draft/new-image";

const SITE = "https://deploy-preview-9--ai-recap.netlify.app";
const IMAGE = { imageUrl: "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-05-21-abc123.jpg", scenePrompt: "A lamp." };
/** The changed current draft, as `chooseNewImage` returns it. */
const CHANGED = {
  draftId: 41,
  issueId: 3,
  version: 3,
  issueDate: "2026-05-21",
  content: { title: "A pretend title" },
  featuredImageUrl: IMAGE.imageUrl,
  scenePrompt: IMAGE.scenePrompt,
};

async function useImage(id: string, body: unknown, signedIn = true) {
  const token = await createApprovalSessionToken();
  const response = await POST(
    new Request(`${SITE}/api/approval/drafts/${id}/image`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(signedIn ? { Cookie: `approval_session=${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, json: await response.json() };
}

describe("POST /api/approval/drafts/[id]/image (Use this image)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    newImage.chooseNewImage.mockResolvedValue(CHANGED);
  });

  it("needs the approval login, and changes nothing without it", async () => {
    const { response } = await useImage("41", IMAGE, false);

    expect(response.status).toBe(401);
    expect(newImage.chooseNewImage).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a number", async () => {
    const { response } = await useImage("-1", IMAGE);

    expect(response.status).toBe(400);
    expect(newImage.chooseNewImage).not.toHaveBeenCalled();
  });

  it("puts the image into this draft and answers with the draft's image", async () => {
    const { response, json } = await useImage("41", IMAGE);

    expect(response.status).toBe(200);
    expect(newImage.chooseNewImage).toHaveBeenCalledTimes(1);
    // The draft id and the body only: there is no job to start, so the route passes no site address.
    expect(newImage.chooseNewImage).toHaveBeenCalledWith(41, IMAGE);
    expect(json).toEqual({ success: true, featuredImageUrl: IMAGE.imageUrl });
  });

  it("passes a body that is not JSON on as nothing, for the check to refuse", async () => {
    newImage.chooseNewImage.mockRejectedValue(new NewImageInputError("Send the image and its scene prompt."));

    const { response, json } = await useImage("41", "not json");

    expect(newImage.chooseNewImage).toHaveBeenCalledWith(41, null);
    expect(response.status).toBe(400);
    expect(json).toEqual({ success: false, error: "Send the image and its scene prompt." });
  });

  it.each([
    [400, new NewImageInputError('"https://elsewhere.example.test/a.jpg" is not an image this site uploaded for 2026-05-21.')],
    [404, new DraftEditError("Draft 41 does not exist.", "missing")],
    [409, new DraftEditError("The draft for 2026-05-21 is failed. Only a ready draft can be changed.", "not_ready")],
    [409, new IssuePublishedError(3, "2026-05-21")],
    [409, new DraftEditError("This is not the newest draft for 2026-05-21. Reload the page.", "not_current")],
    [500, new NewImageConfigError("S3_BUCKET is not set on this deploy, so the chosen image cannot be checked.")],
    [502, new NewImageServiceError("The chosen image is not in S3 as a JPEG (HTTP 404).")],
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
    expect(json).toEqual({ success: false, error: "Could not change the image." });
  });
});
