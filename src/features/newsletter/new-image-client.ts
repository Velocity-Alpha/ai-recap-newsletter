import { jsonPost } from "@/src/features/newsletter/draft-links";
import type { FeaturedImage } from "@/src/pipeline/draft/image/featured-image";
import type { SceneIdea } from "@/src/pipeline/draft/image/scene-ideas";

/**
 * The draft view's calls for "New image" (#116). Safe for client components. Each throws an Error with a plain
 * message the panel can show as is.
 */

const OFFLINE = "Could not reach the server. Try again.";

type Fetch = typeof fetch;
type Body = Record<string, unknown>;

async function post(fetcher: Fetch, url: string, body: unknown = {}): Promise<{ response: Response; body: Body }> {
  let response: Response;
  try {
    response = await fetcher(url, jsonPost(body));
  } catch {
    throw new Error(OFFLINE);
  }
  return { response, body: ((await response.json().catch(() => ({}))) ?? {}) as Body };
}

function reason(body: Body, fallback: string): string {
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

export async function requestSceneIdeas(draftId: number, fetcher: Fetch = fetch): Promise<SceneIdea[]> {
  const { response, body } = await post(fetcher, `/api/approval/drafts/${draftId}/image/ideas`);
  if (!response.ok || !Array.isArray(body.ideas)) throw new Error(reason(body, "Could not suggest scene ideas."));
  return body.ideas as SceneIdea[];
}

/** "Generate": one image from the scene in the box. */
export async function requestImage(draftId: number, scenePrompt: string, fetcher: Fetch = fetch): Promise<FeaturedImage> {
  const { response, body } = await post(fetcher, `/api/approval/drafts/${draftId}/image/generate`, { scenePrompt });
  if (!response.ok || !body.image) throw new Error(reason(body, "Could not make the image."));
  return body.image as FeaturedImage;
}

/** "Use this image": puts the image into the draft. The draft keeps its id and version. */
export async function requestUseImage(draftId: number, image: FeaturedImage, fetcher: Fetch = fetch): Promise<void> {
  const { response, body } = await post(fetcher, `/api/approval/drafts/${draftId}/image`, image);
  if (!response.ok || body.success !== true) throw new Error(reason(body, "Could not change the image."));
}
