import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "approval_session";

async function computeToken(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`approval:${password}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(request: NextRequest) {
  // Let the login page and login API through
  const { pathname } = request.nextUrl;
  if (pathname === "/approval/login" || pathname.startsWith("/api/approval/login")) {
    return NextResponse.next();
  }

  const password = process.env.APPROVAL_PASSWORD;

  // If no password is configured, allow through (dev convenience)
  if (!password) return NextResponse.next();

  const expectedToken = await computeToken(password);
  const sessionCookie = request.cookies.get(COOKIE_NAME);

  if (sessionCookie?.value === expectedToken) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/approval/login", request.url);
  loginUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/approval/:path*"],
};
