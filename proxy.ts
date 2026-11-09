import { NextResponse, type NextRequest } from "next/server";

import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { refuseCrossOriginWrite } from "@/src/server/same-origin";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Writes must come from this site's own pages; API writes must also be JSON.
  const refusal = refuseCrossOriginWrite(request, { requireJson: isApi });
  if (refusal) return refusal;

  // API routes check the session themselves and answer 401, so they are not redirected.
  // Let the login page through.
  if (isApi || pathname === "/approval/login") {
    return NextResponse.next();
  }

  // Fails closed: with APPROVAL_PASSWORD or SESSION_SECRET unset, no session is valid.
  if (await hasValidApprovalSession(request)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/approval/login", request.url);
  loginUrl.searchParams.set("redirect", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Every path that uses the approval session. `/:path*` also matches the bare prefix.
  matcher: ["/approval/:path*", "/api/approval/:path*", "/api/newsletters/commit", "/api/admin/:path*"],
};
