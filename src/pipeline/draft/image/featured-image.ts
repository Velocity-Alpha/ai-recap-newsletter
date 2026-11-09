import { uploadImage, type UploadImageOptions } from "@/src/pipeline/draft/image/s3-upload";
import {
  writeScenePrompt,
  type ScenePromptContext,
  type WriteScenePromptOptions,
} from "@/src/pipeline/draft/image/scene-prompt";
import { generateImage, type GenerateImageOptions } from "@/src/pipeline/draft/image/vertex-image";

/**
 * The draft job's featured image step: scene prompt → image → upload. There is no draft without an image, so a
 * failure throws `FeaturedImageError` naming the step, and the job marks the draft failed at that step.
 * "New image" (#116) calls the three functions on its own instead.
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
