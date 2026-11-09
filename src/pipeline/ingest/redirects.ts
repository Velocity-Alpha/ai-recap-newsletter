/**
 * Newsletters wrap story links in click-tracking addresses. This swaps each tracking link in the text for
 * the address it finally leads to, so the model sees real links. Fixes n8n's resolver, which followed one
 * hop only and put the page body in place of a link that did not redirect.
 */

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const MAX_HOPS = 5;
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 6;

export interface ResolveOptions {
  fetch?: typeof fetch;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** The last address reached, or null when the first request does not redirect or fails. */
async function followRedirects(start: string, send: typeof fetch): Promise<string | null> {
  let current = start;
  let reached: string | null = null;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await send(current, {
        redirect: "manual",
        headers: { "user-agent": BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return reached;
    }
    await response.body?.cancel().catch(() => undefined);
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) return reached;
    try {
      current = new URL(location, current).href;
    } catch {
      return reached;
    }
    reached = current;
  }
  return reached;
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(run));
  }
}

export async function resolveTrackingLinks(text: string, pattern: RegExp, options: ResolveOptions = {}): Promise<string> {
  const send = options.fetch ?? fetch;
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  const unique = [...new Set(text.match(matcher) ?? [])];
  if (unique.length === 0) return text;

  const resolved = new Map<string, string>();
  await inBatches(unique, CONCURRENCY, async (raw) => {
    const target = await followRedirects(decodeEntities(raw), send);
    if (target) resolved.set(raw, target);
  });
  return text.replace(matcher, (raw) => resolved.get(raw) ?? raw);
}
