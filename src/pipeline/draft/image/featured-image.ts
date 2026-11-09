import { publicImageUrl, uploadImage, type UploadImageOptions } from "@/src/pipeline/draft/image/s3-upload";
import {
  writeScenePrompt,
  type ScenePromptContext,
  type WriteScenePromptOptions,
} from "@/src/pipeline/draft/image/scene-prompt";
import { generateImage, type GenerateImageOptions } from "@/src/pipeline/draft/image/vertex-image";
import { s3KeyPrefix } from "@/src/pipeline/side-effects";

/**
 * The draft job's featured image step: scene prompt → image → upload. There is no draft without an image, so a
 * failure throws `FeaturedImageError` naming the step, and the job marks the draft failed at that step.
 * "New image" (#116) skips the scene prompt: the owner writes it, then `makeImageFromScene` makes the image.
 */

export type FeaturedImageStep = "scene_prompt" | "image" | "upload";

export class FeaturedImageError extends Error {
  constructor(
    readonly step: FeaturedImageStep,
    cause: unknown,
  ) {
    super(`Featured image failed at ${step}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "FeaturedImageError";
  }
}

export interface FeaturedImageInput {
  context: ScenePromptContext;
  /** YYYY-MM-DD. Names the S3 key. */
  issueDate: string;
}

export interface FeaturedImage {
  imageUrl: string;
  scenePrompt: string;
}

export interface MakeFeaturedImageOptions {
  /** Defaults to APP_ENV. Picks the S3 prefix. */
  appEnv?: string;
  scene?: WriteScenePromptOptions;
  image?: GenerateImageOptions;
  upload?: Omit<UploadImageOptions, "appEnv">;
}

async function step<T>(name: FeaturedImageStep, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new FeaturedImageError(name, error);
  }
}

export async function makeFeaturedImage(
  input: FeaturedImageInput,
  options: MakeFeaturedImageOptions = {},
): Promise<FeaturedImage> {
  const { scenePrompt } = await step("scene_prompt", () => writeScenePrompt(input.context, options.scene));
  const image = await step("image", () => generateImage(scenePrompt, options.image));
  const imageUrl = await step("upload", () =>
    uploadImage(image.bytes, input.issueDate, { ...options.upload, appEnv: options.appEnv }),
  );
  return { imageUrl, scenePrompt };
}

/** "New image" (#116): the image for a scene the owner wrote, plus the fixed style prompt, uploaded like any other. */
export async function makeImageFromScene(
  input: { scenePrompt: string; issueDate: string },
  options: Omit<MakeFeaturedImageOptions, "scene"> = {},
): Promise<FeaturedImage> {
  const scenePrompt = input.scenePrompt.trim();
  const image = await step("image", () => generateImage(scenePrompt, options.image));
  const imageUrl = await step("upload", () =>
    uploadImage(image.bytes, input.issueDate, { ...options.upload, appEnv: options.appEnv }),
  );
  return { imageUrl, scenePrompt };
}

/**
 * The board sends back the image the owner chose, so check it is one this environment uploaded for the issue's
 * date (`uploadImage`'s URL), and never an outside URL in a subscriber's email. Throws a plain error.
 */
export function checkOwnImage(
  image: FeaturedImage,
  issueDate: string,
  place: { appEnv: string | undefined; bucket: string | undefined },
): FeaturedImage {
  const bucket = place.bucket?.trim();
  if (!bucket) throw new Error("S3_BUCKET is not set, so the chosen image cannot be checked.");
  if (!image.scenePrompt.trim()) throw new Error("The scene prompt is empty.");
  const prefix = publicImageUrl(bucket, `${s3KeyPrefix(place.appEnv)}${issueDate}-`);
  const id = image.imageUrl.startsWith(prefix) ? image.imageUrl.slice(prefix.length) : "";
  // uploadImage's ids are lowercase hex.
  if (!/^[a-z0-9]+\.jpg$/.test(id)) {
    throw new Error(`"${image.imageUrl}" is not an image this site uploaded for ${issueDate}.`);
  }
  return image;
}

export const IMAGE_CHECK_TIMEOUT_MS = 10_000;

/**
 * The image step of a "New image" draft: `checkOwnImage`, then a HEAD request that the file is a JPEG in S3, so the
 * email never points at a missing image. Throws a plain error.
 */
export async function checkUploadedImage(
  image: FeaturedImage,
  issueDate: string,
  place: { appEnv: string | undefined; bucket: string | undefined; fetch?: typeof fetch },
): Promise<FeaturedImage> {
  checkOwnImage(image, issueDate, place);
  let response: Response;
  try {
    response = await (place.fetch ?? fetch)(image.imageUrl, { method: "HEAD", signal: AbortSignal.timeout(IMAGE_CHECK_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`Could not check the chosen image in S3: ${error instanceof Error ? error.message : String(error)}`);
  }
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? null;
  if (response.status !== 200 || type !== "image/jpeg") {
    throw new Error(`The chosen image is not in S3 as a JPEG (HTTP ${response.status}${response.status === 200 && type ? `, ${type}` : ""}).`);
  }
  return image;
}
