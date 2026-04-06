import { unsubscribeSubscriberByToken } from "@/src/features/subscriber/service";
import type { UnsubscribeResponse } from "@/src/features/subscriber/types";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
  logRequestWarning,
} from "@/src/server/observability";

async function getTokenFromRequest(request: Request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");

  if (queryToken) {
    return queryToken;
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => null)) as { token?: string } | null;
    return payload?.token ?? "";
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    return formData.get("token")?.toString() ?? "";
  }

  return "";
}

async function handleUnsubscribe(request: Request) {
  const context = createRequestLogContext("api.subscriber.unsubscribe", request);

  logRequestStart(context, {
    contentType: request.headers.get("content-type"),
  });

  try {
    const token = await getTokenFromRequest(request);
    const result = await unsubscribeSubscriberByToken({ token });

    if (result) {
      logRequestSuccess(context, {
        unsubscribed: true,
      });
    } else {
      logRequestWarning(context, "Subscriber unsubscribe ignored", {
        reason: "invalid_or_missing_token",
      });
    }

    return jsonWithRequestId<UnsubscribeResponse>(context, {
      success: true,
    });
  } catch (error) {
    if (error instanceof Error && /not configured/i.test(error.message)) {
      logRequestError(context, "Subscriber unsubscribe route is not configured", error);

      return jsonWithRequestId(
        context,
        { error: "Subscriber unsubscribe is not configured yet. Set DATABASE_URL and SESSION_SECRET." },
        { status: 500 },
      );
    }

    logRequestError(context, "Unexpected subscriber unsubscribe failure", error);

    return jsonWithRequestId(
      context,
      { error: "Could not unsubscribe that subscriber right now." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleUnsubscribe(request);
}

export async function POST(request: Request) {
  return handleUnsubscribe(request);
}
