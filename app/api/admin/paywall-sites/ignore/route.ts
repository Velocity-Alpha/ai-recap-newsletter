import { NextResponse } from "next/server";

import { ignorePaywallSite } from "@/src/features/admin/paywall-sites";
import { withAdminApi } from "@/src/server/admin-auth";

export const runtime = "nodejs";

/** The "Ignore" button of /admin/settings (#59): the owner says a learned paywalled site is not paywalled. */
export const POST = withAdminApi(async (request) => {
  const body = (await request.json().catch(() => null)) as { site?: unknown } | null;
  const site = typeof body?.site === "string" ? body.site.trim() : "";
  if (!site) return NextResponse.json({ error: "Give the site to ignore." }, { status: 400 });

  if (!(await ignorePaywallSite(site))) {
    return NextResponse.json({ error: "No such site." }, { status: 404 });
  }
  return NextResponse.json({ site, ignored: true });
});
