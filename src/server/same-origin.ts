import { NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses a state-changing request (any method but GET, HEAD, OPTIONS) that a browser sent from another
 * origin. The approval cookie is SameSite=strict, but browsers count every subdomain of airecap.news as
 * the same site and send it from them too, so the check is on the exact origin.
 *
 * - `Origin` present: it must equal the request's own origin.
 * - `Origin` absent: `Sec-Fetch-Site` must be `same-origin`.
 * - Both absent: allowed. Browsers send at least one on these requests, so this is a non-browser client,
 *   and it cannot carry the owner's browser cookie.
 *
 * With `requireJson`, the request must also have `Content-Type: application/json` (otherwise 415).
 * Returns the refusal, or null when the request may go on.
 */
export function refuseCrossOriginWrite(
  request: Request,
  { requireJson = false }: { requireJson?: boolean } = {},
): NextResponse | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }

  if (requireJson && !hasJsonBody(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }

  return null;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === new URL(request.url).origin;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin";

  return true;
}

function hasJsonBody(request: Request): boolean {
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}
