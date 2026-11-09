import { describe, expect, it, vi } from "vitest";

import { checkOwnImage, FeaturedImageError, makeFeaturedImage, makeImageFromScene } from "@/src/pipeline/draft/image/featured-image";
import { STYLE_PROMPT, VERTEX_IMAGE_URL } from "@/src/pipeline/draft/image/vertex-image";

const CONTEXT = {
  subjectLine: "Example Labs Ships a Tiny Robot",
  topStories: [{ headline: "Example Labs Ships a Tiny Robot", detail: "A synthetic story detail." }],
};
const SCENE = "A small brass robot stands on a wooden desk.";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const S3 = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "test-secret-key", region: "us-east-1", bucket: "example-bucket" };

function openAi(output: string | Error) {
  const create = vi.fn(async () => {
    if (output instanceof Error) throw output;
    return { output_text: output };
  });
  return { client: { responses: { create } }, create };
}

/** One fake fetch for both Vertex and S3, routed by URL. */
function outside(options: { vertex?: () => Response; s3?: () => Response } = {}) {
  const vertex =
    options.vertex ??
    (() =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: Buffer.from(JPEG).toString("base64") } }] } },
          ],
        }),
      ));
  const s3 = options.s3 ?? (() => new Response(null, { status: 200 }));
  return vi.fn<typeof fetch>(async (input) => (String(input) === VERTEX_IMAGE_URL ? vertex() : s3()));
}

function options(fetchMock: typeof fetch, client: ReturnType<typeof openAi>["client"]) {
  return {
    appEnv: "preview",
    scene: { client, retryDelayMs: 0 },
    image: { apiKey: "test-vertex-key", fetch: fetchMock, retryDelayMs: 0 },
    upload: { s3: S3, fetch: fetchMock, randomId: () => "ab12cd34", retryDelayMs: 0 },
  };
}

describe("makeFeaturedImage", () => {
  it("writes the scene, makes the image from style + scene, uploads it, and returns the URL and scene", async () => {
    const { client } = openAi(JSON.stringify({ image_prompt: SCENE, editorial_rationale: "Easy to draw." }));
    const fetchMock = outside();

    const result = await makeFeaturedImage({ context: CONTEXT, issueDate: "2026-11-09" }, options(fetchMock, client));

    expect(result).toEqual({
      imageUrl: "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-11-09-ab12cd34.jpg",
      scenePrompt: SCENE,
    });
    const [vertexCall, s3Call] = fetchMock.mock.calls;
    expect(JSON.parse(String(vertexCall[1]?.body)).contents[0].parts[0].text).toBe(`${STYLE_PROMPT}\n - ${SCENE}`);
    expect(s3Call[0]).toBe("https://example-bucket.s3.us-east-1.amazonaws.com/newsletter-dev/2026-11-09-ab12cd34.jpg");
    expect(Array.from(s3Call[1]?.body as Uint8Array)).toEqual(Array.from(JPEG));
  });

  it("fails at the scene prompt step and makes no image", async () => {
    const { client } = openAi(new Error("Request timed out."));
    const fetchMock = outside();

    const failure = makeFeaturedImage({ context: CONTEXT, issueDate: "2026-11-09" }, options(fetchMock, client));

    await expect(failure).rejects.toBeInstanceOf(FeaturedImageError);
    await expect(failure).rejects.toMatchObject({
      step: "scene_prompt",
      message: "Featured image failed at scene_prompt: Scene prompt failed after 3 attempts: Request timed out.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails at the image step and uploads nothing", async () => {
    const { client } = openAi(JSON.stringify({ image_prompt: SCENE, editorial_rationale: "" }));
    const fetchMock = outside({ vertex: () => new Response('{"error":{"message":"Internal"}}', { status: 500 }) });

    const failure = makeFeaturedImage({ context: CONTEXT, issueDate: "2026-11-09" }, options(fetchMock, client));

    await expect(failure).rejects.toMatchObject({ step: "image" });
    await expect(failure).rejects.toThrow("Featured image failed at image: Image failed after 3 attempts");
    expect(fetchMock.mock.calls.every(([url]) => url === VERTEX_IMAGE_URL)).toBe(true);
  });

  it("fails at the upload step", async () => {
    const { client } = openAi(JSON.stringify({ image_prompt: SCENE, editorial_rationale: "" }));
    const fetchMock = outside({ s3: () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }) });

    await expect(
      makeFeaturedImage({ context: CONTEXT, issueDate: "2026-11-09" }, options(fetchMock, client)),
    ).rejects.toMatchObject({ step: "upload", message: expect.stringContaining("S3 returned HTTP 403 (AccessDenied)") });
  });
});

describe("makeImageFromScene (#116)", () => {
  function sceneOptions(fetchMock: typeof fetch) {
    const { appEnv, image, upload } = options(fetchMock, openAi("unused").client);
    return { appEnv, image, upload };
  }

  it("makes the image from the owner's scene plus the style prompt, and uploads it, with no scene prompt call", async () => {
    const fetchMock = outside();

    const result = await makeImageFromScene({ scenePrompt: `  ${SCENE}  `, issueDate: "2026-11-09" }, sceneOptions(fetchMock));

    expect(result).toEqual({
      imageUrl: "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-11-09-ab12cd34.jpg",
      scenePrompt: SCENE,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).contents[0].parts[0].text).toBe(`${STYLE_PROMPT}\n - ${SCENE}`);
  });

  it("refuses an empty scene, and makes nothing", async () => {
    const fetchMock = outside();

    await expect(makeImageFromScene({ scenePrompt: "  ", issueDate: "2026-11-09" }, sceneOptions(fetchMock))).rejects.toMatchObject({
      step: "image",
      message: "Featured image failed at image: The scene prompt is empty.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails at the image step when Vertex fails", async () => {
    const fetchMock = outside({ vertex: () => new Response('{"error":{"message":"Quota"}}', { status: 429 }) });

    const failure = makeImageFromScene({ scenePrompt: SCENE, issueDate: "2026-11-09" }, sceneOptions(fetchMock));

    await expect(failure).rejects.toBeInstanceOf(FeaturedImageError);
    await expect(failure).rejects.toMatchObject({ step: "image", message: expect.stringContaining("Vertex returned HTTP 429: Quota") });
  });
});

describe("checkOwnImage (#116)", () => {
  const IMAGE = { imageUrl: "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-11-09-ab12cd34.jpg", scenePrompt: SCENE };
  const PLACE = { appEnv: "preview", bucket: "example-bucket" };

  it("accepts an image this environment uploaded for the issue's date", () => {
    expect(checkOwnImage(IMAGE, "2026-11-09", PLACE)).toEqual(IMAGE);
    expect(
      checkOwnImage(
        { ...IMAGE, imageUrl: "https://example-bucket.s3.amazonaws.com/newsletter/2026-11-09-ab12cd34.jpg" },
        "2026-11-09",
        { ...PLACE, appEnv: "production" },
      ),
    ).toMatchObject({ scenePrompt: SCENE });
  });

  it.each([
    ["another host", "https://evil.example.test/newsletter-dev/2026-11-09-ab12cd34.jpg"],
    ["another bucket", "https://other-bucket.s3.amazonaws.com/newsletter-dev/2026-11-09-ab12cd34.jpg"],
    ["another environment's prefix", "https://example-bucket.s3.amazonaws.com/newsletter/2026-11-09-ab12cd34.jpg"],
    ["another date", "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-11-10-ab12cd34.jpg"],
    ["a query string", "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-11-09-ab12cd34.jpg?x=1"],
    ["not a URL", "newsletter-dev/2026-11-09-ab12cd34.jpg"],
  ])("refuses %s", (_name, imageUrl) => {
    expect(() => checkOwnImage({ ...IMAGE, imageUrl }, "2026-11-09", PLACE)).toThrow("is not an image this site uploaded for 2026-11-09");
  });

  it("refuses an empty scene prompt, and says when the bucket is not set", () => {
    expect(() => checkOwnImage({ ...IMAGE, scenePrompt: " " }, "2026-11-09", PLACE)).toThrow("The scene prompt is empty.");
    expect(() => checkOwnImage(IMAGE, "2026-11-09", { appEnv: "preview", bucket: undefined })).toThrow("S3_BUCKET is not set");
  });
});
