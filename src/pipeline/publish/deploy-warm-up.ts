import { readWarmPaths } from "@/src/features/newsletter/warm-paths";
import {
  describeWarmUp,
  siteUrlForDeploy,
  warmPagesUntilStored,
  type DeployInfo,
  type WarmUpReport,
} from "@/src/pipeline/publish/site-refresh";

/**
 * Each deploy clears the CDN, so after a deploy the `deploy-succeeded` event function loads the same pages
 * the publish job warms. It loads public pages only, so it needs no token. Only a published production deploy
 * warms the main site; any other deploy (a preview, or a production deploy held back by a locked production)
 * warms only its own address.
 */

/**
 * The deploy in Netlify's event body. Netlify posts `{ payload: <deploy> }` to a function named after the event
 * (docs.netlify.com, "Trigger functions on events", legacy filename convention); the deploy uses the Netlify
 * API's snake_case fields. `published_at` is null while the deploy is not the live one.
 */
interface DeployEventPayload {
  id?: unknown;
  name?: unknown;
  ssl_url?: unknown;
  url?: unknown;
  context?: unknown;
  published_at?: unknown;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** The deploy named in Netlify's event body. The live production deploy means the main site address. */
async function deployFromEvent(request: Request): Promise<DeployInfo | undefined> {
  const body = (await request.json().catch(() => null)) as { payload?: DeployEventPayload } | null;
  const payload = body?.payload;
  if (!payload || !text(payload.id)) return undefined;
  return {
    site: { url: text(payload.ssl_url) ?? text(payload.url), name: text(payload.name) },
    deploy: {
      id: text(payload.id),
      published: payload.context === "production" && text(payload.published_at) !== undefined,
    },
  };
}

/** Where the deploy address came from: Netlify's event body, or the function's own context as a fallback. */
export type DeployAddressSource = "deploy event" | "function context";

export interface DeployWarmUp {
  siteUrl: string;
  source: DeployAddressSource;
  report: WarmUpReport;
}

export interface WarmDeployOptions {
  fetch?: typeof fetch;
  readPaths?: () => Promise<string[]>;
  /** Waits between tries (see `warmPagesUntilStored`). Tests pass a stub. */
  pause?: (ms: number) => Promise<void>;
}

/** Returns undefined when neither the event nor the function context gives a deploy address. */
export async function warmDeploy(
  request: Request,
  context: DeployInfo | undefined,
  options: WarmDeployOptions = {},
): Promise<DeployWarmUp | undefined> {
  const fromEvent = await deployFromEvent(request);
  const fromContext = context?.site && context.deploy ? context : undefined;
  const deploy = fromEvent ?? fromContext;
  const siteUrl = deploy ? siteUrlForDeploy(deploy) : "";
  if (!siteUrl) return undefined;
  const source: DeployAddressSource = fromEvent ? "deploy event" : "function context";
  const paths = await (options.readPaths ?? readWarmPaths)();
  return { siteUrl, source, report: await warmPagesUntilStored(siteUrl, paths, options) };
}

/** The deploy function's log line: the address, where it came from, then the shared warm-up line. */
export function describeDeployWarmUp(warmUp: DeployWarmUp | undefined): { level: "info" | "warn"; message: string } {
  if (!warmUp) return { level: "warn", message: "No deploy address, so no pages were loaded." };
  const { level, message } = describeWarmUp(warmUp.report);
  return { level, message: `${warmUp.siteUrl} (address from the ${warmUp.source}): ${message}` };
}
