import { NextResponse } from "next/server";

import { learnedSites } from "@/src/pipeline/free-links/paywall-sites";
import { siteOf } from "@/src/pipeline/free-links/sites";
import { checkPaywall } from "@/src/pipeline/ingest/paywall";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError } from "@/src/server/observability";

export const runtime = "nodejs";

/**
 * Says if a link the reviewer typed on the board is paywalled (#59): the site lists, then one page check. The
 * board shows the answer as the story's lock icon and asks before it commits a paywalled link.
 */
export async function POST(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!siteOf(url)) {
    return NextResponse.json({ error: "Give an http or https link." }, { status: 400 });
  }

  try {
    const result = await checkPaywall(url, { learnedSites: await learnedSites() });
    return NextResponse.json({ paywall: result.status });
  } catch (error) {
    logServerError("approval.check_link.failed", error, { site: siteOf(url) });
    // 200, not 500: the board shows the link's state as an error and the reviewer can still commit.
    return NextResponse.json({ paywall: "error" });
  }
}
