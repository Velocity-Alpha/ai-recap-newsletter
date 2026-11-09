import { describe, expect, it, vi } from "vitest";

import { FeaturedImageError, makeFeaturedImage } from "@/src/pipeline/draft/image/featured-image";
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
