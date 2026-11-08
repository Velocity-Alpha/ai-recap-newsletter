import { revalidateTag } from "next/cache";

/** One tag on every cache that shows published issues: the lists, the issue pages, and the sitemap. */
export const PUBLISHED_ISSUES_TAG = "published-issues";

/** Without a refresh, a new issue appears within this time. */
export const PUBLISHED_ISSUES_MAX_AGE_SECONDS = 3600;

/**
 * Call after an issue publishes. `expire: 0` makes the next visitor wait for fresh data instead of being
 * served the old list while it refreshes. Works only in Route Handlers and Server Functions.
 */
export function refreshPublishedIssues(): void {
  revalidateTag(PUBLISHED_ISSUES_TAG, { expire: 0 });
}
