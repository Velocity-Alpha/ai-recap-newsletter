import { NextResponse, type NextRequest } from "next/server";

import { hasValidApprovalSession } from "@/src/server/approval-auth";

export async function proxy(request: NextRequest) {
  // Let the login page and login API through
  const { pathname, search } = request.nextUrl;
  if (pathname === "/approval/login" || pathname.startsWith("/api/approval/login")) {
    return NextResponse.next();
  }

  // Fails closed: with APPROVAL_PASSWORD or SESSION_SECRET unset, no session is valid.
  if (await hasValidApprovalSession(request)) {
    return NextResponse.next();
  }

  // API callers get a status, not a login page. Each admin route checks the session again (withAdminApi).
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const loginUrl = new URL("/approval/login", request.url);
  loginUrl.searchParams.set("redirect", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/approval/:path*", "/admin/:path*", "/api/admin/:path*"],
};
