import { NextResponse } from "next/server";

import { subscribeAndUpsertSubscriber, SubscriberError } from "@/src/features/subscriber/service";
import { setSubscriberSessionCookie } from "@/src/features/subscriber/server";
import type { SubscribeResponse } from "@/src/features/subscriber/types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      firstName?: string;
      email?: string;
      path?: string | null;
      source?: string;
    };
    const { subscriber, newlySubscribed } = await subscribeAndUpsertSubscriber({
      firstName: payload.firstName ?? "",
      email: payload.email ?? "",
      source: payload.source?.trim() || "article_gate",
      path: payload.path ?? null,
    });

    const response = NextResponse.json<SubscribeResponse>({
      success: true,
      newlySubscribed,
    });
    setSubscriberSessionCookie(response.cookies, subscriber);

    return response;
  } catch (error) {
    if (error instanceof SubscriberError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode },
      );
    }

    if (error instanceof Error && /not configured/i.test(error.message)) {
      return NextResponse.json(
        { error: "Subscriber signup is not configured yet. Set DATABASE_URL, SESSION_SECRET, and GHL_SUBSCRIBE_WEBHOOK_URL." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: "Could not subscribe right now." },
      { status: 500 },
    );
  }
}
