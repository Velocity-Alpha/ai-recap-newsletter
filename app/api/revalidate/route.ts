import { NextResponse } from "next/server";

import { PUBLISHED_ISSUES_TAG, refreshPublishedIssues } from "@/src/features/newsletter/cache";
import { isValidCacheRefreshToken } from "@/src/server/cache-refresh-auth";
import { logServerInfo, logServerWarn } from "@/src/server/observability";

export const runtime = "nodejs";

/**
 * Refreshes the cached lists, issue pages, and sitemap. The publish job calls it after it publishes an
 * issue, with a short-lived token signed from SESSION_SECRET (see cache-refresh-auth).
 */
export async function POST(request: Request) {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Cache refresh is not configured." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  if (!isValidCacheRefreshToken(token, secret, new Date())) {
    logServerWarn("api.revalidate.rejected", { hasToken: Boolean(token) });
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  refreshPublishedIssues();
  logServerInfo("api.revalidate", { tags: [PUBLISHED_ISSUES_TAG] });
  return NextResponse.json({ refreshed: [PUBLISHED_ISSUES_TAG] });
}
