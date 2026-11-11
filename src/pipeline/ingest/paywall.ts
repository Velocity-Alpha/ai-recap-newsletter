import { BROWSER_USER_AGENT } from "@/src/pipeline/ingest/redirects";

/**
 * Tags a story link as paywalled or not, for the icon on the approval board. n8n's check marked about 90%
 * of stories `unknown` or `error`. Changes: known free sites skip the fetch (Product Hunt always blocked
 * it), the publisher's own structured data decides first, and weak wording such as a footer
 * "Already a subscriber?" no longer counts.
 *
 * The check is staged (#59) and stops at the first step that answers. No AI call decides it.
 * 1. Site list (`checkSiteList`): the lists below plus the learned paywalled sites. No network.
 * 2. Page check: one fetch of the page, then its markup and wording.
 * `checkPaywall` is steps 1 and 2.
 */

export type PaywallStatus = "yes" | "no" | "unknown" | "error";
export interface PaywallResult {
  status: PaywallStatus;
  /** Why the fetch failed, for the `stories.error` column. "" otherwise. */
  error: string;
}

// n8n's list of paywalled publishers.
const PAYWALLED = [
  "adweek.com", "americanbanker.com", "barrons.com", "bloomberg.com", "businessinsider.com", "caixinglobal.com",
  "cen.acs.org", "chronicle.com", "computerweekly.com", "darkreading.com", "digiday.com", "economist.com",
  "financialpost.com", "fnlondon.com", "foreignaffairs.com", "foreignpolicy.com", "fortune.com", "forbes.com",
  "ft.com", "genomeweb.com", "hbr.org", "inc.com", "insidehighered.com", "latimes.com", "marketwatch.com",
  "medscape.com", "nationalgeographic.com", "newscientist.com", "newyorker.com", "nytimes.com", "qz.com",
  "reuters.com", "science.org", "scientificamerican.com", "seekingalpha.com", "slate.com", "sloanreview.mit.edu",
  "spglobal.com", "statista.com", "techinasia.com", "techtarget.com", "technologyreview.com", "theatlantic.com",
  "theglobeandmail.com", "theinformation.com", "theverge.com", "timeshighereducation.com", "washingtonpost.com",
  "wired.com", "wsj.com",
];
const FREE = ["producthunt.com", "huggingface.co", "github.com", "arxiv.org", "youtube.com", "youtu.be"];

// The publisher's own markup (schema.org and the Open Graph content tier) decides first.
const MARKED_LOCKED = [
  /"isAccessibleForFree"\s*:\s*"?false"?/i,
  /itemprop=["']isAccessibleForFree["'][^>]*content=["']false["']/i,
  /property=["']article:content_tier["'][^>]*content=["'](locked|metered)["']/i,
];
const MARKED_FREE = [
  /"isAccessibleForFree"\s*:\s*"?true"?/i,
  /itemprop=["']isAccessibleForFree["'][^>]*content=["']true["']/i,
  /property=["']article:content_tier["'][^>]*content=["']free["']/i,
];
// Then clear subscriber-only wording.
const LOCKED_WORDING = [
  /subscriber[- ]only/i,
  /subscribe to (continue|keep) reading/i,
  /(content|article|story) is (only )?available (only )?to subscribers/i,
  /available to subscribers only/i,
  /create (a free )?account to (continue|keep) reading/i,
];

const TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 1_500_000;

/** True when the host is a site on the list or one of its subdomains. */
export function isOnSiteList(hostname: string, sites: readonly string[]): boolean {
  return sites.some((site) => hostname === site || hostname.endsWith(`.${site}`));
}

/** Step 1, no network: "yes" or "no" when a site list knows the link's site, null when none does. */
export function checkSiteList(url: string, learnedSites: readonly string[] = []): "yes" | "no" | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (isOnSiteList(hostname, PAYWALLED) || isOnSiteList(hostname, learnedSites)) return "yes";
  if (isOnSiteList(hostname, FREE)) return "no";
  return null;
}

export interface CheckPaywallOptions {
  fetch?: typeof fetch;
  /** The learned paywalled sites (src/pipeline/free-links/sites.ts). They count like the `PAYWALLED` list. */
  learnedSites?: readonly string[];
}

export async function checkPaywall(url: string, options: CheckPaywallOptions = {}): Promise<PaywallResult> {
  if (!URL.canParse(url)) return { status: "unknown", error: "" };
  const listed = checkSiteList(url, options.learnedSites);
  if (listed) return { status: listed, error: "" };

  const send = options.fetch ?? fetch;
  let body: string;
  try {
    const response = await send(url, {
      headers: { "user-agent": BROWSER_USER_AGENT, accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "error", error: `HTTP ${response.status}` };
    }
    body = (await response.text()).slice(0, MAX_BODY_CHARS);
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.name : "FetchError" };
  }

  const matches = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(body));
  if (matches(MARKED_LOCKED)) return { status: "yes", error: "" };
  if (matches(MARKED_FREE)) return { status: "no", error: "" };
  if (matches(LOCKED_WORDING)) return { status: "yes", error: "" };
  return { status: "unknown", error: "" };
}
