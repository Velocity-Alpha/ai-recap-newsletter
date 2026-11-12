import { fetchPublishedNewsletterEntries } from "@/src/features/newsletter/repository";

/**
 * The pages to load after a publish or a deploy, in order, so the first reader gets a cached page rather
 * than a cold render: the home page, the archive, and the newest issue. Reads the database directly, not
 * the cache, because it runs right after the cache was cleared. Never throws: without the newest issue it
 * still returns the two list pages. Must not import `next/*`: the deploy event function uses it.
 */
export async function readWarmPaths(): Promise<string[]> {
  const paths = ["/", "/archive"];
  try {
    const [newest] = await fetchPublishedNewsletterEntries();
    if (newest?.slug) paths.push(`/issue/${newest.slug}`);
  } catch {
    // The list pages still get warmed.
  }
  return paths;
}
