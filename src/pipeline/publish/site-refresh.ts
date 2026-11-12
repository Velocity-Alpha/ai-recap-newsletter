import { createCacheRefreshToken } from "@/src/server/cache-refresh-auth";

/**
 * The publish job runs outside Next.js, so it cannot refresh the site's cache itself. It asks the site to
 * do it through POST /api/revalidate.
 */

/** The parts of the Netlify function context this needs. */
export interface DeployInfo {
  site: { url?: string; name?: string };
  deploy: { id?: string; published?: boolean };
}

/** The published deploy refreshes the main site. A preview refreshes only itself. */
export function siteUrlForDeploy({ site, deploy }: DeployInfo): string {
  if (deploy.published || !deploy.id || !site.name) return site.url ?? "";
  return `https://${deploy.id}--${site.name}.netlify.app`;
}

export interface SiteRefresherOptions {
  siteUrl: string;
  secret: string | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Which pages loaded after a refresh or a deploy, and which did not. */
export interface WarmUpReport {
  warmed: string[];
  failed: { path: string; reason: string }[];
}

/** "/archive (HTTP 500), /issue/x (timeout)", for the run log and the function log. */
export function listFailedPages(failed: WarmUpReport["failed"]): string {
  return failed.map(({ path, reason }) => `${path} (${reason})`).join(", ");
}

/** A cold render can take about 9 s; this leaves room for a slow database wake-up. */
const PAGE_LOAD_TIMEOUT_MS = 20_000;

/**
 * Loads each public page once, one after another, so the CDN caches it before a reader asks. Never throws:
 * a page that fails is reported, and the rest still load.
 */
export async function warmPages(
  siteUrl: string,
  paths: string[],
  options: { fetch?: typeof fetch } = {},
): Promise<WarmUpReport> {
  const send = options.fetch ?? fetch;
  const base = siteUrl.replace(/\/+$/, "");
  const report: WarmUpReport = { warmed: [], failed: [] };
  for (const path of paths) {
    try {
      const response = await send(`${base}${path}`, { signal: AbortSignal.timeout(PAGE_LOAD_TIMEOUT_MS) });
      // Read the body so the whole page has rendered before the next one starts.
      await response.text();
      if (response.ok) report.warmed.push(path);
      else report.failed.push({ path, reason: `HTTP ${response.status}` });
    } catch (error) {
      report.failed.push({ path, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

/** The site-relative paths in the refresh answer. Anything else is ignored. */
async function readWarmPaths(response: Response): Promise<string[]> {
  const body = (await response.json().catch(() => null)) as { warm?: unknown } | null;
  if (!Array.isArray(body?.warm)) return [];
  return body.warm.filter((path): path is string => typeof path === "string" && /^\/(?!\/)/.test(path));
}

/**
 * Refreshes the site, then warms the pages the site names. Throws only when the refresh fails, and then
 * loads no pages. Returns undefined when the site address or SESSION_SECRET is missing.
 */
export function createSiteRefresher(options: SiteRefresherOptions): (() => Promise<WarmUpReport>) | undefined {
  const secret = options.secret?.trim();
  if (!secret || !options.siteUrl) return undefined;
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const siteUrl = options.siteUrl;
  const url = `${siteUrl.replace(/\/+$/, "")}/api/revalidate`;

  return async () => {
    const response = await send(url, {
      method: "POST",
      headers: { authorization: `Bearer ${createCacheRefreshToken(secret, now())}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Site refresh failed with HTTP ${response.status}.`);
    return warmPages(siteUrl, await readWarmPaths(response), { fetch: send });
  };
}

/** The refresher for a Netlify function: its own deploy's address and SESSION_SECRET. */
export function createNetlifySiteRefresher(
  context: DeployInfo | undefined,
  env: Record<string, string | undefined> = process.env,
): (() => Promise<WarmUpReport>) | undefined {
  if (!context?.site || !context.deploy) return undefined;
  return createSiteRefresher({ siteUrl: siteUrlForDeploy(context), secret: env.SESSION_SECRET });
}
