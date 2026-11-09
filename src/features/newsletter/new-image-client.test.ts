import { describe, expect, it, vi } from "vitest";

import { requestImage, requestImageDraft, requestSceneIdeas } from "@/src/features/newsletter/new-image-client";

const IMAGE = { imageUrl: "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-05-21-abc123.jpg", scenePrompt: "A pretend lamp." };

function answer(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("requestSceneIdeas", () => {
  it("posts JSON to the draft's ideas route, with an empty object, and returns the ideas", async () => {
    const fetcher = answer(200, { ideas: [{ label: "Lamp", scene: "A pretend lamp." }] });

    await expect(requestSceneIdeas(41, fetcher)).resolves.toEqual([{ label: "Lamp", scene: "A pretend lamp." }]);
    // The Origin check (#128) answers a write that is not JSON with 415.
    expect(fetcher).toHaveBeenCalledWith("/api/approval/drafts/41/image/ideas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  });

  it("throws the server's plain reason, or a plain fallback", async () => {
    await expect(requestSceneIdeas(41, answer(502, { error: "Scene ideas failed: Request timed out." }))).rejects.toThrow(
      "Scene ideas failed: Request timed out.",
    );
    await expect(requestSceneIdeas(41, answer(500, {}))).rejects.toThrow("Could not suggest scene ideas.");
    await expect(requestSceneIdeas(41, vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("offline"))))).rejects.toThrow(
      "Could not reach the server. Try again.",
    );
  });
});

describe("requestImage", () => {
  it("sends the scene from the box and returns the new image", async () => {
    const fetcher = answer(200, { image: IMAGE });

    await expect(requestImage(41, "A pretend lamp.", fetcher)).resolves.toEqual(IMAGE);
    expect(fetcher).toHaveBeenCalledWith("/api/approval/drafts/41/image/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenePrompt: "A pretend lamp." }),
    });
  });

  it("throws the server's plain reason", async () => {
    await expect(requestImage(41, "x", answer(502, { error: "Featured image failed at image: Vertex returned HTTP 429: Quota" }))).rejects.toThrow(
      "Vertex returned HTTP 429",
    );
    await expect(requestImage(41, "x", answer(500, {}))).rejects.toThrow("Could not make the image.");
  });
});

describe("requestImageDraft", () => {
  it("sends the chosen image and returns the new draft's id", async () => {
    const fetcher = answer(200, { success: true, draft: { draftId: 42, version: 3 } });

    await expect(requestImageDraft(41, IMAGE, fetcher)).resolves.toEqual({ draftId: 42, error: null });
    expect(fetcher).toHaveBeenCalledWith("/api/approval/drafts/41/image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(IMAGE),
    });
  });

  it("still returns the new draft when its job did not start, so the page can show it with Retry", async () => {
    const fetcher = answer(502, { success: false, error: "Starting the draft job failed with HTTP 500.", draft: { draftId: 42 } });

    await expect(requestImageDraft(41, IMAGE, fetcher)).resolves.toEqual({ draftId: 42, error: "Starting the draft job failed with HTTP 500." });
  });

  it("throws the plain reason when no draft was made", async () => {
    await expect(requestImageDraft(41, IMAGE, answer(409, { success: false, error: "The issue for 2026-05-21 is already published." }))).rejects.toThrow(
      "already published",
    );
    await expect(requestImageDraft(41, IMAGE, answer(500, {}))).rejects.toThrow("Could not make the new draft.");
  });
});
