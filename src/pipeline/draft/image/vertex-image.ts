import { withRetries } from "@/src/pipeline/draft/image/retry";

/**
 * The featured image itself: the fixed style prompt plus the scene, sent to Vertex AI Gemini. Ported from n8n
 * `2.2.2 Sub: Generate Stylized Image From Prompt` (docs/n8n-backend/20-drafting-and-images.md §4). The key is a
 * Vertex "express mode" API key, sent in a header, on the global endpoint (no project or location in the URL).
 */

export const IMAGE_MODEL = "gemini-3.1-flash-image";
export const VERTEX_IMAGE_URL = `https://aiplatform.googleapis.com/v1/publishers/google/models/${IMAGE_MODEL}:generateContent`;
export const IMAGE_TIMEOUT_MS = 120_000;
export const IMAGE_RETRIES = 2;

/** The fixed part of every image prompt, verbatim from n8n (typo included, so the look does not drift). */
export const STYLE_PROMPT = `- Watercolor editorial illustration with expressive realism, confident gestural brushwork, controlled blooms, and occasional drips.

- Limited earth-tone palette (ochre, burnt sienna), cool grays, and muted blues.

- **Isolated on a white background **

- **All edges must fade out into the bacgkround using a wet-on-wet watercolor bleed.**

- The composition is a central vignette. No elements or colours should touch the frame borders.

- No paper texture, grain, fibers, canvas noise, or film noise. Only watercolor pigment behavior is visible.

- No captions, decorative typography, UI overlays, or watermarks.

- Readable logos allowed only when specified, integrated physically into the scene, minimal.

- Do not add extra characters, objects, text, or scenery beyond what the brief describes.`;

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: "image/jpeg";
}

export interface GenerateImageOptions {
  /** Defaults to VERTEX_API_KEY. */
  apiKey?: string;
  fetch?: typeof fetch;
  /** Wait between attempts. n8n waits 5 s. */
  retryDelayMs?: number;
  /** Attempts after the first. Defaults to `IMAGE_RETRIES`; the board's Generate button uses 0. */
  retries?: number;
  /** Per attempt. Defaults to `IMAGE_TIMEOUT_MS`. A route must finish inside Netlify's 60 s. */
  timeoutMs?: number;
}

/** 2.2.2's request body. The text is `<style>\n - <scene>`, as n8n sends it. */
export function buildImageRequestBody(scenePrompt: string) {
  return {
    contents: [{ role: "user", parts: [{ text: `${STYLE_PROMPT}\n - ${scenePrompt}` }] }],
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
  };
}

interface VertexResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
  }>;
}

async function vertexErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const message = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.slice(0, 200) || response.statusText;
}

/** Same check as n8n's `Convert to Binary`: the first part that carries an image. */
export function readImage(body: VertexResponse): GeneratedImage {
  const candidate = body.candidates?.[0];
  const image = candidate?.content?.parts?.find((part) => part.inlineData)?.inlineData;
  if (!image?.data) throw new Error(`No image in response (finishReason: ${candidate?.finishReason ?? "unknown"})`);
  if (image.mimeType !== "image/jpeg") throw new Error(`Vertex returned ${image.mimeType}, not image/jpeg.`);
  return { bytes: new Uint8Array(Buffer.from(image.data, "base64")), mimeType: "image/jpeg" };
}

/** Makes the featured image for a scene. Tries 3 times (2 retries), each with a 120 s timeout. */
export async function generateImage(scenePrompt: string, options: GenerateImageOptions = {}): Promise<GeneratedImage> {
  const apiKey = options.apiKey ?? process.env.VERTEX_API_KEY;
  if (!apiKey) throw new Error("VERTEX_API_KEY is not set.");
  if (!scenePrompt.trim()) throw new Error("The scene prompt is empty.");
  const fetchImpl = options.fetch ?? fetch;
  const body = JSON.stringify(buildImageRequestBody(scenePrompt));

  return withRetries(
    "Image",
    async () => {
      const response = await fetchImpl(VERTEX_IMAGE_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? IMAGE_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Vertex returned HTTP ${response.status}: ${await vertexErrorMessage(response)}`);
      return readImage((await response.json()) as VertexResponse);
    },
    { retries: options.retries ?? IMAGE_RETRIES, delayMs: options.retryDelayMs ?? 5_000 },
  );
}
