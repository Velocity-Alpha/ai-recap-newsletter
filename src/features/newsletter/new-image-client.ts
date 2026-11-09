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

/**
 * "Use this image": the new draft's id. When the draft was made but its job did not start, it still returns the id
 * (with the error), so the page can show that draft with "Retry".
 */
export async function requestImageDraft(
  draftId: number,
  image: FeaturedImage,
  fetcher: Fetch = fetch,
): Promise<{ draftId: number; error: string | null }> {
  const { response, body } = await post(fetcher, `/api/approval/drafts/${draftId}/image`, image);
  const made = (body.draft as { draftId?: unknown } | undefined)?.draftId;
  if (typeof made !== "number") throw new Error(reason(body, "Could not make the new draft."));
  return { draftId: made, error: response.ok ? null : reason(body, "The new draft's job did not start.") };
}
