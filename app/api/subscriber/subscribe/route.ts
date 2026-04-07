import { subscribeAndUpsertSubscriber, SubscriberError } from "@/features/subscriber/service";
import { setSubscriberSessionCookie } from "@/features/subscriber/session";
import type { SubscribeResponse } from "@/features/subscriber/types";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
  logRequestWarning,
  maskEmail,
} from "@/server/observability";

export async function POST(request: Request) {
  const context = createRequestLogContext("api.subscriber.subscribe", request);
  let email: string | undefined;
  let source: string | undefined;
  let path: string | null | undefined;

  logRequestStart(context, {
    contentType: request.headers.get("content-type"),
  });

  try {
    const payload = (await request.json()) as {
      firstName?: string;
      email?: string;
      path?: string | null;
      source?: string;
    };
    email = payload.email ?? "";
    source = payload.source?.trim() || "article_gate";
    path = payload.path ?? null;

    const { subscriber, newlySubscribed } = await subscribeAndUpsertSubscriber({
      firstName: payload.firstName ?? "",
      email,
      source,
      path,
    });

    const response = jsonWithRequestId<SubscribeResponse>(context, {
      success: true,
      newlySubscribed,
    });
    setSubscriberSessionCookie(response.cookies, subscriber);

    logRequestSuccess(context, {
      email: maskEmail(email),
      source,
      path,
      subscriberId: subscriber.id,
      newlySubscribed,
    });

    return response;
  } catch (error) {
    if (error instanceof SubscriberError) {
      logRequestWarning(context, "Subscriber subscribe rejected", {
        email: maskEmail(email),
        source,
        path,
        statusCode: error.statusCode,
        code: error.code,
        reason: error.message,
      });

      return jsonWithRequestId(
        context,
        { error: error.message, code: error.code },
        { status: error.statusCode },
      );
    }

    if (error instanceof Error && /not configured/i.test(error.message)) {
      logRequestError(context, "Subscriber subscribe route is not configured", error, {
        email: maskEmail(email),
        source,
        path,
      });

      return jsonWithRequestId(
        context,
        { error: "Subscriber signup is not configured yet. Set DATABASE_URL, SESSION_SECRET, and GHL_SUBSCRIBE_WEBHOOK_URL." },
        { status: 500 },
      );
    }

    logRequestError(context, "Unexpected subscriber subscribe failure", error, {
      email: maskEmail(email),
      source,
      path,
    });

    return jsonWithRequestId(
      context,
      { error: "Could not subscribe right now." },
      { status: 500 },
    );
  }
}
