import { NextResponse } from "next/server";

import { clearSubscriberSessionCookie } from "@/src/features/subscriber/server";

export async function POST() {
  const response = NextResponse.json({ success: true });
  clearSubscriberSessionCookie(response.cookies);
  return response;
}
