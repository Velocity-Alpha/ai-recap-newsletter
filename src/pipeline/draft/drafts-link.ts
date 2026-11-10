/**
 * Links to the drafts page, for alerts and messages. No database and no job code, so a route can import it
 * without the draft job.
 */

const SITE_URL = "https://airecap.news";

/** This deploy's site: Netlify's `URL` in production, the deploy's own address on previews, else production. */
export function siteUrl(env: Record<string, string | undefined>): string {
  const candidates = env.APP_ENV === "production" ? [env.URL] : [env.DEPLOY_PRIME_URL, env.URL];
  const url = candidates.map((value) => value?.trim()).find(Boolean);
  return (url ?? SITE_URL).replace(/\/+$/, "");
}

/** The drafts page for a date (#79), where the owner sees the draft, a failed step, and "Retry". */
export function draftsLink(date: string, env: Record<string, string | undefined> = {}): string {
  return `${siteUrl(env)}/approval/drafts?date=${encodeURIComponent(date)}`;
}
