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
  /** Waits between tries (see `warmPagesUntilStored`). Tests pass a stub. */
  pause?: (ms: number) => Promise<void>;
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
 * Netlify keeps one cached copy per compression (Brotli, gzip, none). Browsers ask for Brotli; Node's fetch
 * asks only for gzip unless told, which would warm a copy no browser reads.
 */
const BROWSER_ACCEPT_ENCODING = "br, gzip";

/** The newest issue's page among the pages to warm. Every other page warmed (the lists) links it. */
function newestIssuePath(paths: string[]): string | undefined {
  return paths.find((path) => path.startsWith("/issue/"));
}

/** A warm-up pass: the report, plus the pages that loaded but did not link the newest issue (old copies). */
async function loadPages(
  siteUrl: string,
  paths: string[],
  options: { fetch?: typeof fetch; newestIssue?: string },
): Promise<{ report: WarmUpReport; oldPages: string[] }> {
  const send = options.fetch ?? fetch;
  const base = withoutTrailingSlash(siteUrl);
  const report: WarmUpReport = { warmed: [], failed: [], cacheStatus: {} };
  const oldPages: string[] = [];
  for (const path of paths) {
    try {
      const response = await send(`${base}${path}`, {
        headers: { "accept-encoding": BROWSER_ACCEPT_ENCODING },
        signal: AbortSignal.timeout(PAGE_LOAD_TIMEOUT_MS),
      });
      // Read the body so the whole page has rendered before the next one starts.
      const html = await response.text();
      const durable = durableCacheStatus(response.headers.get("cache-status"));
      if (durable && report.cacheStatus) report.cacheStatus[path] = durable;
      if (!response.ok) {
        report.failed.push({ path, reason: `HTTP ${response.status}` });
        continue;
      }
      report.warmed.push(path);
      const { newestIssue } = options;
      if (newestIssue && path !== newestIssue && !html.includes(`href="${newestIssue}"`)) oldPages.push(path);
    } catch (error) {
      report.failed.push({ path, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { report, oldPages };
}

/**
 * Loads each public page once, one after another, so the CDN caches it before a reader asks. Never throws:
 * a page that fails is reported, and the rest still load.
 */
export async function warmPages(
  siteUrl: string,
  paths: string[],
  options: { fetch?: typeof fetch } = {},
): Promise<WarmUpReport> {
  return (await loadPages(siteUrl, paths, options)).report;
}

/**
 * A warmed page can come back without the new copy stored. In the first seconds after a deploy Netlify's
 * durable cache can answer `fwd=bypass`. Right after a refresh the CDN can still answer with the old page
 * (`hit`, or an Edge hit with no durable status) because the purge runs after the refresh answer and takes a
 * moment to reach every cache. Such a page is loaded again after a pause, at most twice. A list page is old
 * when it does not link the newest issue. If one is still old before the last try, `refreshAgain` runs first:
 * a copy stored after the purge stays old until another purge.
 */
const RETRY_PAUSE_MS = 3_000;
const RETRIES = 2;

const notStoredYet = (status: string | undefined) => !!status && (status.startsWith("fwd=bypass") || status.startsWith("hit"));

export async function warmPagesUntilStored(
  siteUrl: string,
  paths: string[],
  options: {
    fetch?: typeof fetch;
    pause?: (ms: number) => Promise<void>;
    refreshAgain?: () => Promise<void>;
  } = {},
): Promise<WarmUpReport> {
  const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const load = { fetch: options.fetch, newestIssue: newestIssuePath(paths) };
  const first = await loadPages(siteUrl, paths, load);
  const report = first.report;
  let oldPages = first.oldPages;
  for (let retry = 0; retry < RETRIES; retry++) {
    const again = report.warmed.filter((path) => oldPages.includes(path) || notStoredYet(report.cacheStatus?.[path]));
    if (again.length === 0) break;
    if (retry === RETRIES - 1 && oldPages.length > 0 && options.refreshAgain) {
      await options.refreshAgain();
      // The second refresh clears the newest issue page too, so it is loaded again with the old pages.
      if (load.newestIssue && report.warmed.includes(load.newestIssue) && !again.includes(load.newestIssue)) {
        again.push(load.newestIssue);
      }
    }
    await pause(RETRY_PAUSE_MS);
    const retried = await loadPages(siteUrl, again, load);
    report.warmed = report.warmed.filter((path) => !retried.report.failed.some((failure) => failure.path === path));
    report.failed.push(...retried.report.failed);
    report.cacheStatus = { ...report.cacheStatus, ...retried.report.cacheStatus };
    oldPages = retried.oldPages;
  }
  for (const path of oldPages) {
    report.warmed = report.warmed.filter((warmed) => warmed !== path);
    report.failed.push({ path, reason: "still the old page, without the newest issue" });
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

  const refresh = () =>
    send(url, {
      method: "POST",
      headers: { authorization: `Bearer ${createCacheRefreshToken(secret, now())}` },
      signal: AbortSignal.timeout(10_000),
    });
  // The second refresh is best effort: if it fails, the old page is reported by the warm-up.
  const refreshAgain = async () => void (await refresh().catch(() => undefined));

  return async () => {
    const response = await refresh();
    if (!response.ok) throw new Error(`Site refresh failed with HTTP ${response.status}.`);
    return warmPagesUntilStored(siteUrl, await parseWarmPaths(response), {
      fetch: send,
      pause: options.pause,
      refreshAgain,
    });
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
