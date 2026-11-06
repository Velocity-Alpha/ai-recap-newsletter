/**
 * URL matching for the approval board's duplicate check.
 *
 * The cleaning mirrors the n8n ingestion `Clean Data` step
 * (docs/n8n-backend/10-ingestion.md, "URL canonicalisation"), which is how
 * `stories.url` is stored, so a stored URL and a fresh one compare equal.
 */

const MAX_DECODE_ROUNDS = 3;

function decodeRepeatedly(value: string): string {
  // A "%" that does not start an escape would make decodeURI throw.
  let decoded = value.replace(/%(?![0-9a-f]{2})/gi, "%25");
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    try {
      const next = decodeURI(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function cleanStoryUrl(raw: string): { host: string; path: string } | null {
  let url = decodeRepeatedly(raw.trim().normalize("NFC").replace(/？/g, "?"));
  if (!url) return null;

  url = url.replace(/^http:\/\//i, "https://");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
  url = url.split(/[?#]/, 1)[0];

  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]*)(.*)$/i);
  if (!match || !match[1]) return null;

  const host = match[1].toLowerCase();
  const path = match[2].replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return { host, path };
}

/**
 * True for pages that collect many different stories, where a shared URL does
 * not mean the same story: homepages, one-word index pages such as `/blog` or
 * `/watch` (ingestion drops the query, so every YouTube video ends up as
 * `/watch`), Product Hunt product pages (one per product, many launches) and
 * GitHub repository homes (one per repo, many releases).
 */
function isMultiStoryPage(host: string, segments: string[]): boolean {
  if (segments.length === 0) return true;
  if (segments.length === 1 && !/[-0-9]/.test(segments[0])) return true;

  const site = host.replace(/^www\./, "");
  if (site === "producthunt.com" && segments[0] === "products") return true;
  if (site === "github.com" && segments.length <= 2) return true;
  return false;
}

/**
 * Returns the cleaned URL used to match two stories, or null when the URL is
 * missing or points to a page that can hold different stories.
 */
export function storyUrlKey(url: string | null | undefined): string | null {
  if (!url) return null;

  const cleaned = cleanStoryUrl(url);
  if (!cleaned) return null;

  const segments = cleaned.path.split("/").filter(Boolean);
  if (isMultiStoryPage(cleaned.host, segments)) return null;

  return `https://${cleaned.host}${cleaned.path}`;
}
