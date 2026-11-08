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

/** Returns undefined when the site address or SESSION_SECRET is missing. */
export function createSiteRefresher(options: SiteRefresherOptions): (() => Promise<void>) | undefined {
  const secret = options.secret?.trim();
  if (!secret || !options.siteUrl) return undefined;
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const url = `${options.siteUrl.replace(/\/+$/, "")}/api/revalidate`;

  return async () => {
    const response = await send(url, {
      method: "POST",
      headers: { authorization: `Bearer ${createCacheRefreshToken(secret, now())}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Site refresh failed with HTTP ${response.status}.`);
  };
}

/** The refresher for a Netlify function: its own deploy's address and SESSION_SECRET. */
export function createNetlifySiteRefresher(
  context: DeployInfo | undefined,
  env: Record<string, string | undefined> = process.env,
): (() => Promise<void>) | undefined {
  if (!context?.site || !context.deploy) return undefined;
  return createSiteRefresher({ siteUrl: siteUrlForDeploy(context), secret: env.SESSION_SECRET });
}
