import { draftEditErrorResponse } from "@/src/pipeline/draft/draft-edit";
import { editCurrentDraft, readCurrentDraft, type CurrentDraft } from "@/src/pipeline/draft/draft-store";
import {
  checkOwnImage,
  checkUploadedImage,
  FeaturedImageError,
  makeImageFromScene,
  type FeaturedImage,
} from "@/src/pipeline/draft/image/featured-image";
import { suggestSceneIdeas, type SceneIdea } from "@/src/pipeline/draft/image/scene-ideas";
import { imageContextFor } from "@/src/pipeline/draft/produce-draft";

/**
 * "New image" on the draft view (#116, #149). The owner starts from the current draft: scene ideas, then
 * "Generate" as often as needed, then "Use this image", which puts the image into the same draft (ADR 0005).
 * No new draft, no job, and no call to the distribution service. The routes under
 * /api/approval/drafts/[id]/image call these.
 */

/**
 * A route must finish inside Netlify's 60 s, so "Generate" makes one image attempt and one upload attempt, each
 * with these timeouts.
 */
export const BOARD_IMAGE_TIMEOUT_MS = 40_000;
export const BOARD_UPLOAD_TIMEOUT_MS = 10_000;
/** The n8n scene prompts are 200 to 300 words. This leaves room for edits, and stops a pasted essay. */
export const MAX_SCENE_PROMPT_CHARS = 4_000;

/** The request is not usable (400). */
export class NewImageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewImageInputError";
  }
}

/** This deploy is missing a setting (500). Trying again will not help. */
export class NewImageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewImageConfigError";
  }
}

/** The model, Vertex, or S3 failed (502). The owner can try again. */
export class NewImageServiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "NewImageServiceError";
  }
}

type Env = Record<string, string | undefined>;

function sceneFrom(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new NewImageInputError("Write a scene prompt first.");
  const scene = value.trim();
  if (scene.length > MAX_SCENE_PROMPT_CHARS) {
    throw new NewImageInputError(`The scene prompt is ${scene.length} characters. Keep it under ${MAX_SCENE_PROMPT_CHARS}.`);
  }
  return scene;
}

/** Three scene ideas from the draft's subject line and top stories (one GPT-6 Luna call). */
export async function suggestIdeasForDraft(draftId: number, options: { env?: Env } = {}): Promise<SceneIdea[]> {
  const env = options.env ?? process.env;
  const source = await readCurrentDraft(draftId);
  try {
    return await suggestSceneIdeas(imageContextFor(source.content), { apiKey: env.OPENAI_API_KEY });
  } catch (error) {
    throw new NewImageServiceError(error instanceof Error ? error.message : String(error), error);
  }
}

/**
 * "Generate": one image from the owner's scene plus the fixed style prompt, uploaded to S3 under this
 * environment's prefix. The draft does not change until the owner picks an image.
 */
export async function generateImageForDraft(draftId: number, body: unknown, options: { env?: Env } = {}): Promise<FeaturedImage> {
  const env = options.env ?? process.env;
  const scenePrompt = sceneFrom((body as { scenePrompt?: unknown } | null)?.scenePrompt);
  const source = await readCurrentDraft(draftId);
  return makeImageFromScene(
    { scenePrompt, issueDate: source.issueDate },
    {
      appEnv: env.APP_ENV,
      image: { apiKey: env.VERTEX_API_KEY, retries: 0, timeoutMs: BOARD_IMAGE_TIMEOUT_MS },
      upload: { retries: 0, timeoutMs: BOARD_UPLOAD_TIMEOUT_MS },
    },
  );
}

export interface ChooseImageOptions {
  env?: Env;
  now?: () => Date;
  /** For the HEAD request to S3 (tests replace it). */
  fetch?: typeof fetch;
}

/**
 * "Use this image": checks the image is one "Generate" uploaded for this date and is in S3 as a JPEG, then puts
 * it into the current draft. Throws `IssuePublishedError` once the date's issue is published.
 */
export async function chooseNewImage(draftId: number, body: unknown, options: ChooseImageOptions = {}): Promise<CurrentDraft> {
  const env = options.env ?? process.env;
  // A setting problem is the deploy's, not the request's: say so before looking at the request.
  if (!env.S3_BUCKET?.trim()) throw new NewImageConfigError("S3_BUCKET is not set on this deploy, so the chosen image cannot be checked.");
  const { imageUrl, scenePrompt } = (body ?? {}) as { imageUrl?: unknown; scenePrompt?: unknown };
  if (typeof imageUrl !== "string" || typeof scenePrompt !== "string") {
    throw new NewImageInputError("Send the image and its scene prompt.");
  }
  const image = { imageUrl: imageUrl.trim(), scenePrompt: sceneFrom(scenePrompt) };
  const current = await readCurrentDraft(draftId);
  const place = { appEnv: env.APP_ENV, bucket: env.S3_BUCKET, fetch: options.fetch };
  try {
    checkOwnImage(image, current.issueDate, place);
  } catch (error) {
    throw new NewImageInputError(error instanceof Error ? error.message : String(error));
  }
  try {
    // So the email never points at a missing image.
    await checkUploadedImage(image, current.issueDate, place);
  } catch (error) {
    throw new NewImageServiceError(error instanceof Error ? error.message : String(error), error);
  }
  return editCurrentDraft(draftId, { image }, { now: options.now });
}

/** The status and plain message for a "New image" refusal or failure. Null for anything unexpected (a 500). */
export function newImageErrorResponse(error: unknown): { status: number; error: string } | null {
  if (error instanceof NewImageInputError) return { status: 400, error: error.message };
  if (error instanceof NewImageConfigError) return { status: 500, error: error.message };
  const refused = draftEditErrorResponse(error);
  if (refused) return refused;
  if (error instanceof FeaturedImageError || error instanceof NewImageServiceError) return { status: 502, error: error.message };
  return null;
}
