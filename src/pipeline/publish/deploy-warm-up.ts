import { readWarmPaths } from "@/src/features/newsletter/warm-paths";
import {
  listFailedPages,
  siteUrlForDeploy,
  warmPages, type DeployInfo, type WarmUpReport } from "@/src/pipeline/publish/site-refresh";

/**
 * Each deploy clears the CDN, so after a deploy the `deploy-succeeded` event function loads the same pages
 * the publish job warms. It loads public pages only, so it needs no token. A preview warms only itself.
 */

interface DeployEventPayload {
  id?: unknown;
  name?: unknown;
  ssl_url?: unknown;
  url?: unknown;
  context?: unknown;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** The deploy named in Netlify's event body. Production means the main site address. */
async function deployFromEvent(request: Request): Promise<DeployInfo | undefined> {
  const body = (await request.json().catch(() => null)) as { payload?: DeployEventPayload } | null;
  const payload = body?.payload;
  if (!payload || !text(payload.id)) return undefined;
  return {
    site: { url: text(payload.ssl_url) ?? text(payload.url), name: text(payload.name) },
    deploy: { id: text(payload.id), published: payload.context === "production" },
  };
}

export interface WarmDeployOptions {
  fetch?: typeof fetch;
  readPaths?: () => Promise<string[]>;
}

/** Returns undefined when neither the event nor the function context gives a deploy address. */
export async function warmDeploy(
  request: Request,
  context: DeployInfo | undefined,
  options: WarmDeployOptions = {},
): Promise<WarmUpReport | undefined> {
  const deploy = (await deployFromEvent(request)) ?? (context?.site && context.deploy ? context : undefined);
  const siteUrl = deploy ? siteUrlForDeploy(deploy) : "";
  if (!siteUrl) return undefined;
  const paths = await (options.readPaths ?? readWarmPaths)();
  return warmPages(siteUrl, paths, { fetch: options.fetch });
}

export function describeWarmUp(report: WarmUpReport | undefined): string {
  if (!report) return "No deploy address, so no pages were loaded.";
  const total = report.warmed.length + report.failed.length;
  const loaded = `Loaded ${report.warmed.length} of ${total} pages.`;
  if (report.failed.length === 0) return loaded;
  return `${loaded} Failed: ${listFailedPages(report.failed)}.`;
}
