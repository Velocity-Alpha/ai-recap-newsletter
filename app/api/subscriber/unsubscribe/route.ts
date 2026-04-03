import { NextResponse } from "next/server";

import { SubscriberError, unsubscribeSubscriber } from "@/src/features/subscriber/service";
import type { UnsubscribeResponse } from "@/src/features/subscriber/types";

async function getPayload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await request.json()) as { email?: string };
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    return {
      email: formData.get("email")?.toString(),
    };
  }

  return {};
}

export async function POST(request: Request) {
  try {
    const payload = await getPayload(request);
    await unsubscribeSubscriber({
      email: payload.email,
    });

    return NextResponse.json<UnsubscribeResponse>({
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
        { error: "Subscriber unsubscribe is not configured yet. Set DATABASE_URL." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: "Could not unsubscribe that subscriber right now." },
      { status: 500 },
    );
  }
}
