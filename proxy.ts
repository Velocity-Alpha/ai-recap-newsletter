import { NextResponse, type NextRequest } from "next/server";

import {
  APPROVAL_SESSION_COOKIE_NAME,
  createApprovalSessionToken,
} from "@/src/server/approval-auth";

export async function proxy(request: NextRequest) {
  // Let the login page and login API through
  const { pathname, search } = request.nextUrl;
  if (pathname === "/approval/login" || pathname.startsWith("/api/approval/login")) {
    return NextResponse.next();
  }

  const password = process.env.APPROVAL_PASSWORD;

  // If no password is configured, allow through (dev convenience)
  if (!password) return NextResponse.next();

  const expectedToken = await createApprovalSessionToken(password);
  const sessionCookie = request.cookies.get(APPROVAL_SESSION_COOKIE_NAME);

  if (sessionCookie?.value === expectedToken) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/approval/login", request.url);
  loginUrl.searchParams.set("redirect", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/approval/:path*"],
};
