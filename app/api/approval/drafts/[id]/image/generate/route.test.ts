import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { FeaturedImageError } from "@/src/pipeline/draft/image/featured-image";
import { createApprovalSessionToken } from "@/src/server/approval-auth";
import { RATE_LIMITS } from "@/src/server/rate-limit";
import type { RateLimitStore } from "@/src/server/rate-limit-store";

const limits = vi.hoisted(() => ({ store: null as RateLimitStore | null }));
vi.mock("@/src/server/rate-limit-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/server/rate-limit-store")>()),
  getRateLimitStore: () => limits.store,
}));

const newImage = vi.hoisted(() => ({ generateImageForDraft: vi.fn() }));
vi.mock("@/src/pipeline/draft/new-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/new-image")>()),
  ...newImage,
}));

import { POST } from "@/app/api/approval/drafts/[id]/image/generate/route";
import { NewImageInputError } from "@/src/pipeline/draft/new-image";
import { createMemoryRateLimitStore } from "@/src/server/rate-limit-store";

const IMAGE = { imageUrl: "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-05-21-abc123.jpg", scenePrompt: "A lamp." };

async function generate(id: string, body: unknown, signedIn = true, session?: string) {
  const token = session ?? (await createApprovalSessionToken());
  const response = await POST(
    new Request(`https://deploy-preview-9--ai-recap.netlify.app/api/approval/drafts/${id}/image/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(signedIn ? { Cookie: `approval_session=${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, json: await response.json() };
}

describe("POST /api/approval/drafts/[id]/image/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limits.store = createMemoryRateLimitStore();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    newImage.generateImageForDraft.mockResolvedValue(IMAGE);
  });

  it("needs the approval login", async () => {
    const { response } = await generate("41", { scenePrompt: "A lamp." }, false);

    expect(response.status).toBe(401);
    expect(newImage.generateImageForDraft).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a number", async () => {
    const { response } = await generate("0", { scenePrompt: "A lamp." });

    expect(response.status).toBe(400);
    expect(newImage.generateImageForDraft).not.toHaveBeenCalled();
  });

  it("makes the image from the scene in the box and returns it", async () => {
    const { response, json } = await generate("41", { scenePrompt: "A lamp." });

    expect(response.status).toBe(200);
    expect(newImage.generateImageForDraft).toHaveBeenCalledWith(41, { scenePrompt: "A lamp." });
    expect(json).toEqual({ image: IMAGE });
  });

  it("passes a body that is not JSON on as nothing, for the check to refuse", async () => {
    newImage.generateImageForDraft.mockRejectedValue(new NewImageInputError("Write a scene prompt first."));

    const { response, json } = await generate("41", "not json");

    expect(newImage.generateImageForDraft).toHaveBeenCalledWith(41, null);
    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "Write a scene prompt first." });
  });

  it.each([
    [409, new IssuePublishedError(3, "2026-05-21")],
    [502, new FeaturedImageError("image", new Error("Vertex returned HTTP 429: Quota"))],
  ])("answers %i with the plain reason", async (status, error) => {
    newImage.generateImageForDraft.mockRejectedValue(error);

    const { response, json } = await generate("41", { scenePrompt: "A lamp." });

    expect(response.status).toBe(status);
    expect(json).toEqual({ error: error.message });
  });

  it("answers 500 without details for anything else", async () => {
    newImage.generateImageForDraft.mockRejectedValue(new Error("boom"));

    const { response, json } = await generate("41", { scenePrompt: "A lamp." });

    expect(response.status).toBe(500);
    expect(json).toEqual({ error: "Could not make the image." });
  });

  it(`allows ${RATE_LIMITS.approvalImageGenerate.limit} images per session in an hour`, async () => {
    const session = await createApprovalSessionToken();
    for (let i = 0; i < RATE_LIMITS.approvalImageGenerate.limit; i++) {
      const { response } = await generate("41", { scenePrompt: "A lamp." }, true, session);
      expect(response.status).toBe(200);
    }
    expect(newImage.generateImageForDraft).toHaveBeenCalledTimes(RATE_LIMITS.approvalImageGenerate.limit);
  });

  it("answers 429 in plain words past the limit, without making an image", async () => {
    const session = await createApprovalSessionToken();
    for (let i = 0; i < RATE_LIMITS.approvalImageGenerate.limit; i++) await generate("41", { scenePrompt: "A lamp." }, true, session);
    newImage.generateImageForDraft.mockClear();

    const { response, json } = await generate("41", { scenePrompt: "A lamp." }, true, session);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(json.error).toMatch(/^Too many images this hour\. Try again in about (a minute|\d+ minutes)\.$/);
    expect(newImage.generateImageForDraft).not.toHaveBeenCalled();

    // Another session has its own count.
    const other = await generate("41", { scenePrompt: "A lamp." });
    expect(other.response.status).toBe(200);
  });
});
