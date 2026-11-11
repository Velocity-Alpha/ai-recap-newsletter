import { describeFreeLinksRun, findFreeLinks } from "@/src/pipeline/free-links/find-free-links";
import { readFreeLinksJobRequest } from "@/src/pipeline/free-links/start-free-links";

// The search for free links (#59). The "-background" name gives it 15 minutes; findFreeLinks starts no new story
// after 9. Only startFreeLinksJob starts it, with the story ids and a short-lived job token signed for those ids.
// findFreeLinks does nothing for a story that is not paywalled or was searched before.
export default async function findFreeLinksBackground(request: Request): Promise<void> {
  const storyIds = await readFreeLinksJobRequest(request, process.env, new Date());
  if (storyIds === null) {
    console.warn("[find-free-links-background] Rejected a request without a valid job token and story ids.");
    return;
  }
  // Never throw: Netlify retries a failed background function, and a story with an error stays not searched.
  try {
    console.log(`[find-free-links-background] ${describeFreeLinksRun(await findFreeLinks(storyIds))}`);
  } catch (error) {
    console.error(`[find-free-links-background] ${error instanceof Error ? error.message : String(error)}`);
  }
}
