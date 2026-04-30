import { NextResponse, type NextRequest } from "next/server";

import {
  APPROVAL_SESSION_COOKIE_NAME,
  createApprovalSessionToken,
} from "@/src/server/approval-auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { password } = body as { password?: string };

  const expectedPassword = process.env.APPROVAL_PASSWORD;

  if (!expectedPassword || !password || password !== expectedPassword) {
    return NextResponse.json({ error: "Password incorrect." }, { status: 401 });
  }

  const token = await createApprovalSessionToken(expectedPassword);
  const response = NextResponse.json({ success: true });

  response.cookies.set(APPROVAL_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  });

  return response;
}
