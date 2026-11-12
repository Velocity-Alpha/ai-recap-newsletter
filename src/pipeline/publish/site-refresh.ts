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
  /** What Netlify's durable cache did with each warmed page (for example "fwd=uri-miss; stored"), when it says. */
  cacheStatus?: Record<string, string>;
}

/**
 * One line about a warm-up, for the publish run log and the deploy function log. A page that failed to load
 * still works (its first reader waits for a render), so failures are a warning.
 */
export function describeWarmUp({ warmed, failed, cacheStatus = {} }: WarmUpReport): {
  level: "info" | "warn";
  message: string;
} {
  const loaded = `Loaded ${warmed.length} of ${warmed.length + failed.length} pages for the cache`;
  const warmedPages = warmed.map((path) => (cacheStatus[path] ? `${path} (${cacheStatus[path]})` : path)).join(", ");
  if (failed.length === 0) {
    return { level: "info", message: warmed.length > 0 ? `${loaded}: ${warmedPages}.` : `${loaded}.` };
  }
  const failedPages = failed.map(({ path, reason }) => `${path} (${reason})`).join(", ");
  return {
    level: "warn",
    message: `${loaded}. Could not load ${failedPages}. The first reader of those pages waits for a fresh render.`,
  };
}

/** The Netlify Durable entry of a `cache-status` header, without its name: `"Netlify Durable"; hit` gives `hit`. */
function durableCacheStatus(header: string | null): string | undefined {
  const entry = header?.split(",").find((part) => part.includes('"Netlify Durable"'));
  return entry?.replace(/^\s*"Netlify Durable";\s*/, "").trim() || undefined;
}

function withoutTrailingSlash(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

/** A cold render can take about 9 s; this leaves room for a slow database wake-up. */
const PAGE_LOAD_TIMEOUT_MS = 20_000;

/**
 * Loads each public page once, one after another, so the CDN caches it before a reader asks. Never throws:
 * a page that fails is reported, and the rest still load.
 */
/**
 * Netlify keeps one cached copy per compression (Brotli, gzip, none). Browsers ask for Brotli; Node's fetch
 * asks only for gzip unless told, which would warm a copy no browser reads.
 */
const BROWSER_ACCEPT_ENCODING = "br, gzip";

export async function warmPages(
  siteUrl: string,
  paths: string[],
  options: { fetch?: typeof fetch } = {},
): Promise<WarmUpReport> {
  const send = options.fetch ?? fetch;
  const base = withoutTrailingSlash(siteUrl);
  const report: WarmUpReport = { warmed: [], failed: [], cacheStatus: {} };
  for (const path of paths) {
    try {
      const response = await send(`${base}${path}`, {
        headers: { "accept-encoding": BROWSER_ACCEPT_ENCODING },
        signal: AbortSignal.timeout(PAGE_LOAD_TIMEOUT_MS),
      });
      // Read the body so the whole page has rendered before the next one starts.
      await response.text();
      const durable = durableCacheStatus(response.headers.get("cache-status"));
      if (durable && report.cacheStatus) report.cacheStatus[path] = durable;
      if (response.ok) report.warmed.push(path);
      else report.failed.push({ path, reason: `HTTP ${response.status}` });
    } catch (error) {
      report.failed.push({ path, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

/** The site-relative paths in the refresh answer. Anything else is ignored. */
async function parseWarmPaths(response: Response): Promise<string[]> {
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
  const url = `${withoutTrailingSlash(siteUrl)}/api/revalidate`;

  return async () => {
    const response = await send(url, {
      method: "POST",
      headers: { authorization: `Bearer ${createCacheRefreshToken(secret, now())}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Site refresh failed with HTTP ${response.status}.`);
    return warmPages(siteUrl, await parseWarmPaths(response), { fetch: send });
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
