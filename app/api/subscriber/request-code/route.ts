import { NextResponse } from "next/server";

import { requestSubscriberSignInCode, SubscriberError } from "@/src/features/subscriber/service";
import type { RequestCodeResponse } from "@/src/features/subscriber/types";

function getRequestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string };

    await requestSubscriberSignInCode({
      email: payload.email ?? "",
      requestIp: getRequestIp(request),
      requestUserAgent: request.headers.get("user-agent"),
    });

    return NextResponse.json<RequestCodeResponse>({
      success: true,
    });
  } catch (error) {
    if (error instanceof SubscriberError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    if (error instanceof Error && /not configured/i.test(error.message)) {
      return NextResponse.json(
        { error: "Subscriber sign-in is not configured yet. Set DATABASE_URL, SESSION_SECRET, RESEND_API_KEY, and RESEND_FROM_EMAIL." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: "Could not send a sign-in code right now." },
      { status: 500 },
    );
  }
}
