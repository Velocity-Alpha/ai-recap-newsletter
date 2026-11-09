import { describe, expect, it, vi } from "vitest";

import {
  buildImageRequestBody,
  generateImage,
  IMAGE_MODEL,
  STYLE_PROMPT,
  VERTEX_IMAGE_URL,
} from "@/src/pipeline/draft/image/vertex-image";

const SCENE = "A small brass robot stands on a wooden desk.";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

function vertexResponse(parts: unknown[], finishReason = "STOP") {
  return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const IMAGE_PART = { inlineData: { mimeType: "image/jpeg", data: Buffer.from(JPEG).toString("base64") } };

function fakeFetch(...responses: Array<Response | Error>) {
  return vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
}

describe("STYLE_PROMPT", () => {
  it("is n8n's fixed watercolor style, kept in code", () => {
    expect(STYLE_PROMPT.startsWith("- Watercolor editorial illustration with expressive realism")).toBe(true);
    expect(STYLE_PROMPT.endsWith("Do not add extra characters, objects, text, or scenery beyond what the brief describes.")).toBe(
      true,
    );
  });
});

describe("buildImageRequestBody", () => {
  it("is 2.2.2's request: style then scene, 16:9, 1K, JPEG", () => {
    expect(buildImageRequestBody(SCENE)).toEqual({
      contents: [{ role: "user", parts: [{ text: `${STYLE_PROMPT}\n - ${SCENE}` }] }],
      generationConfig: {
        temperature: 1,
        maxOutputTokens: 32768,
        responseModalities: ["IMAGE"],
        topP: 0.95,
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "1K",
          imageOutputOptions: { mimeType: "image/jpeg" },
          personGeneration: "ALLOW_ALL",
        },
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      ],
    });
  });
});

describe("generateImage", () => {
  it("posts to Vertex with the API key header and returns the JPEG bytes", async () => {
    const fetchMock = fakeFetch(vertexResponse([{ text: "thinking" }, IMAGE_PART]));

    const image = await generateImage(SCENE, { apiKey: "test-vertex-key", fetch: fetchMock, retryDelayMs: 0 });

    expect(image.mimeType).toBe("image/jpeg");
    expect(Array.from(image.bytes)).toEqual(Array.from(JPEG));
    expect(IMAGE_MODEL).toBe("gemini-3.1-flash-image");
    expect(VERTEX_IMAGE_URL).toBe(
      "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-flash-image:generateContent",
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(VERTEX_IMAGE_URL);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json", "x-goog-api-key": "test-vertex-key" });
    expect(JSON.parse(String(init?.body))).toEqual(buildImageRequestBody(SCENE));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads the key from VERTEX_API_KEY", async () => {
    vi.stubEnv("VERTEX_API_KEY", "env-vertex-key");
    try {
      const fetchMock = fakeFetch(vertexResponse([IMAGE_PART]));
      await generateImage(SCENE, { fetch: fetchMock, retryDelayMs: 0 });
      expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>)["x-goog-api-key"]).toBe("env-vertex-key");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails before calling Vertex when the key is missing or the scene is empty", async () => {
    vi.stubEnv("VERTEX_API_KEY", "");
    try {
      const fetchMock = fakeFetch();
      await expect(generateImage(SCENE, { fetch: fetchMock })).rejects.toThrow("VERTEX_API_KEY is not set");
      await expect(generateImage("  ", { apiKey: "k", fetch: fetchMock })).rejects.toThrow("scene prompt is empty");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("retries twice, then reports the last error without the key", async () => {
    const fetchMock = fakeFetch(
      new Error("fetch failed"),
      new Response('{"error":{"message":"Quota exceeded"}}', { status: 429 }),
      vertexResponse([{ text: "no picture" }], "IMAGE_SAFETY"),
    );

    const failure = generateImage(SCENE, { apiKey: "secret-vertex-key", fetch: fetchMock, retryDelayMs: 0 });

    await expect(failure).rejects.toThrow("Image failed after 3 attempts: No image in response (finishReason: IMAGE_SAFETY)");
    await expect(failure).rejects.not.toThrow("secret-vertex-key");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports an HTTP error with its status and Vertex's message", async () => {
    const error = () => new Response('{"error":{"code":403,"message":"API key not valid."}}', { status: 403 });
    const fetchMock = fakeFetch(error(), error(), error());

    await expect(generateImage(SCENE, { apiKey: "k", fetch: fetchMock, retryDelayMs: 0 })).rejects.toThrow(
      "Vertex returned HTTP 403: API key not valid.",
    );
  });

  it("makes one attempt when the caller asks for no retries (the board's Generate button)", async () => {
    const fetchMock = fakeFetch(new Response('{"error":{"message":"Busy"}}', { status: 503 }), vertexResponse([IMAGE_PART]));

    await expect(generateImage(SCENE, { apiKey: "k", fetch: fetchMock, retries: 0, timeoutMs: 40_000 })).rejects.toThrow(
      "Image failed after 1 attempts: Vertex returned HTTP 503: Busy",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses an image that is not a JPEG", async () => {
    const png = { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } };
    const fetchMock = fakeFetch(vertexResponse([png]), vertexResponse([png]), vertexResponse([png]));

    await expect(generateImage(SCENE, { apiKey: "k", fetch: fetchMock, retryDelayMs: 0 })).rejects.toThrow(
      "Vertex returned image/png, not image/jpeg",
    );
  });
});
