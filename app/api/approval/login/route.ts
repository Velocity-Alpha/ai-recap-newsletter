import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "approval_session";

async function computeToken(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`approval:${password}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { password } = body as { password?: string };

  const expectedPassword = process.env.APPROVAL_PASSWORD;

  if (!expectedPassword || !password || password !== expectedPassword) {
    return NextResponse.json({ error: "Password incorrect." }, { status: 401 });
  }

  const token = await computeToken(expectedPassword);
  const response = NextResponse.json({ success: true });

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  });

  return response;
}
