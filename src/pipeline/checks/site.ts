import type { SiteFacts } from "@/src/pipeline/checks/checks";

/** The 18:00 site check reads only the public site: the issue page and the home page. */

export const PUBLIC_SITE_URL = "https://airecap.news";

const TIMEOUT_MS = 10_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(html: string): string {
  return html.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return ENTITIES[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** True when the page text holds `text`, after undoing HTML escapes and folding whitespace. */
export function htmlContainsText(html: string, text: string): boolean {
  return squash(decodeEntities(html)).includes(squash(text));
}

async function readPage(url: string, fetchPage: typeof fetch): Promise<{ status: number | null; body: string; error?: string }> {
  try {
    const response = await fetchPage(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: response.status, body: response.ok ? await response.text() : "" };
  } catch (error) {
    return { status: null, body: "", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Fetches both pages at once. Never throws: a failed fetch is reported in the facts. */
export async function readSiteFacts(
  issue: { slug: string; title: string },
  options: { siteUrl: string; fetch?: typeof fetch },
): Promise<SiteFacts> {
  const base = options.siteUrl.replace(/\/+$/, "");
  const fetchPage = options.fetch ?? fetch;
  const issuePath = `/issue/${issue.slug}`;
  const issueUrl = `${base}${issuePath}`;
  const homeUrl = `${base}/`;

  const [page, home] = await Promise.all([readPage(issueUrl, fetchPage), readPage(homeUrl, fetchPage)]);
  return {
    issueUrl,
    issuePage: {
      status: page.status,
      hasTitle: page.status === 200 && htmlContainsText(page.body, issue.title),
      ...(page.error && { error: page.error }),
    },
    homeUrl,
    home: {
      status: home.status,
      listsIssue: home.status === 200 && home.body.includes(`"${issuePath}"`),
      ...(home.error && { error: home.error }),
    },
  };
}
