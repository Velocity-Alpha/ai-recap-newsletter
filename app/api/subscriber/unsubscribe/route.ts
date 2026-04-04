import { SubscriberError, unsubscribeSubscriber } from "@/src/features/subscriber/service";
import type { UnsubscribeResponse } from "@/src/features/subscriber/types";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
  logRequestWarning,
  maskEmail,
} from "@/src/server/observability";

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
  const context = createRequestLogContext("api.subscriber.unsubscribe", request);
  let email: string | null | undefined;

  logRequestStart(context, {
    contentType: request.headers.get("content-type"),
  });

  try {
    const payload = await getPayload(request);
    email = payload.email ?? null;
    await unsubscribeSubscriber({
      email: payload.email,
    });

    logRequestSuccess(context, {
      email: maskEmail(email),
    });

    return jsonWithRequestId<UnsubscribeResponse>(context, {
      success: true,
    });
  } catch (error) {
    if (error instanceof SubscriberError) {
      logRequestWarning(context, "Subscriber unsubscribe rejected", {
        email: maskEmail(email),
        statusCode: error.statusCode,
        reason: error.message,
      });

      return jsonWithRequestId(
        context,
        { error: error.message },
        { status: error.statusCode },
      );
    }

    if (error instanceof Error && /not configured/i.test(error.message)) {
      logRequestError(context, "Subscriber unsubscribe route is not configured", error, {
        email: maskEmail(email),
      });

      return jsonWithRequestId(
        context,
        { error: "Subscriber unsubscribe is not configured yet. Set DATABASE_URL." },
        { status: 500 },
      );
    }

    logRequestError(context, "Unexpected subscriber unsubscribe failure", error, {
      email: maskEmail(email),
    });

    return jsonWithRequestId(
      context,
      { error: "Could not unsubscribe that subscriber right now." },
      { status: 500 },
    );
  }
}
