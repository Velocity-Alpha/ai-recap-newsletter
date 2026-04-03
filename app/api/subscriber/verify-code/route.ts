import { NextResponse } from "next/server";

import { setSubscriberSessionCookie } from "@/src/features/subscriber/server";
import { verifySubscriberSignInCode, SubscriberError } from "@/src/features/subscriber/service";
import type { VerifyCodeResponse } from "@/src/features/subscriber/types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string; code?: string };
    const subscriber = await verifySubscriberSignInCode({
      email: payload.email ?? "",
      code: payload.code ?? "",
    });

    const response = NextResponse.json<VerifyCodeResponse>({
      success: true,
    });
    setSubscriberSessionCookie(response.cookies, subscriber);

    return response;
  } catch (error) {
    if (error instanceof SubscriberError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    if (error instanceof Error && /not configured/i.test(error.message)) {
      return NextResponse.json(
        { error: "Subscriber sign-in is not configured yet. Set DATABASE_URL and SESSION_SECRET." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: "Could not verify that code right now." },
      { status: 500 },
    );
  }
}
