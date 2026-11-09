import crypto from "node:crypto";

/**
 * Story links, cleaned the way n8n's `Clean Data` node did, with one fix: n8n dropped the whole query
 * string, which broke links such as YouTube `watch?v=`. Only tracking parameters are removed now.
 */

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "_hsenc",
  "_hsmi",
  "ref",
  "ref_src",
]);

const LONE_PERCENT = /%(?![0-9a-f]{2})/gi;

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

function decodeRepeatedly(value: string): string {
  let current = value.replace(LONE_PERCENT, "%25");
  for (let round = 0; round < 3; round += 1) {
    try {
      const decoded = decodeURI(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current.replace(LONE_PERCENT, "%25");
}

/** Returns "" when the value is not an http(s) link. */
export function cleanStoryUrl(raw: string | null | undefined): string {
  let value = (raw ?? "").trim().normalize("NFC").replace(/？/g, "?");
  if (!value) return "";
  value = decodeRepeatedly(value);
  if (/^http:\/\//i.test(value)) value = value.replace(/^http:\/\//i, "https://");
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".")) return "";

  const path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const query = new URLSearchParams();
  for (const [name, paramValue] of url.searchParams) {
    if (!isTrackingParam(name)) query.append(name, paramValue);
  }
  const search = query.toString();
  return `https://${url.host.toLowerCase()}${path}${search ? `?${search}` : ""}`;
}

/** n8n's formula: `md5("<day> || <cleaned url>")`. Keeping it means re-ingested stories update in place. */
export function storyGuid(day: string, cleanedUrl: string): string {
  return crypto.createHash("md5").update(`${day} || ${cleanedUrl}`).digest("hex");
}
