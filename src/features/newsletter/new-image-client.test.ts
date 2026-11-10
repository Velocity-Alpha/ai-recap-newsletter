import { describe, expect, it, vi } from "vitest";

import { requestImage, requestSceneIdeas, requestUseImage } from "@/src/features/newsletter/new-image-client";

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

  it("passes the per-session limit's message on as is", async () => {
    const tooMany = "Too many images this hour. Try again in about 12 minutes.";
    await expect(requestImage(41, "x", answer(429, { error: tooMany }))).rejects.toThrow(tooMany);
    const tooManyIdeas = "Too many scene idea requests this hour. Try again in about a minute.";
    await expect(requestSceneIdeas(41, answer(429, { error: tooManyIdeas }))).rejects.toThrow(tooManyIdeas);
  });
});

describe("requestUseImage", () => {
  it("sends the chosen image to the same draft, and resolves with nothing when the draft was changed", async () => {
    const fetcher = answer(200, { success: true });

    await expect(requestUseImage(41, IMAGE, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/approval/drafts/41/image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(IMAGE),
    });
  });

  it("throws the server's plain reason when the image was not changed", async () => {
    await expect(requestUseImage(41, IMAGE, answer(409, { success: false, error: "The issue for 2026-05-21 is already published." }))).rejects.toThrow(
      "The issue for 2026-05-21 is already published.",
    );
    await expect(
      requestUseImage(41, IMAGE, answer(409, { success: false, error: "This is not the newest draft for 2026-05-21. Reload the page." })),
    ).rejects.toThrow("Reload the page.");
  });

  it("carries the HTTP status on the error, so the page can read the draft again after a refusal", async () => {
    await expect(requestUseImage(41, IMAGE, answer(409, { success: false, error: "The issue is already published." }))).rejects.toMatchObject({
      name: "DraftRequestError",
      status: 409,
    });
    await expect(requestUseImage(41, IMAGE, answer(500, {}))).rejects.toMatchObject({ status: 500 });
    await expect(requestImage(41, "x", answer(429, { error: "Too many images this hour." }))).rejects.toMatchObject({ status: 429 });
    await expect(requestUseImage(41, IMAGE, vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("offline"))))).rejects.toMatchObject({
      status: null,
    });
  });

  it("throws a plain fallback when the server gives no reason", async () => {
    await expect(requestUseImage(41, IMAGE, answer(500, {}))).rejects.toThrow("Could not change the image.");
    await expect(requestUseImage(41, IMAGE, answer(500, { error: "" }))).rejects.toThrow("Could not change the image.");
    const notJson = vi.fn<typeof fetch>(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(requestUseImage(41, IMAGE, notJson)).rejects.toThrow("Could not change the image.");
  });

  it("does not take a 200 without success as a change", async () => {
    await expect(requestUseImage(41, IMAGE, answer(200, {}))).rejects.toThrow("Could not change the image.");
    await expect(requestUseImage(41, IMAGE, answer(200, { success: false, error: "The image was not saved." }))).rejects.toThrow(
      "The image was not saved.",
    );
  });

  it("does not take a failed answer that says success as a change", async () => {
    await expect(requestUseImage(41, IMAGE, answer(502, { success: true }))).rejects.toThrow("Could not change the image.");
  });

  it("says when the server could not be reached", async () => {
    await expect(requestUseImage(41, IMAGE, vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("offline"))))).rejects.toThrow(
      "Could not reach the server. Try again.",
    );
  });
});
