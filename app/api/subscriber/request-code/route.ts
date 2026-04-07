import { requestSubscriberSignInCode, SubscriberError } from "@/features/subscriber/service";
import type { RequestCodeResponse } from "@/features/subscriber/types";
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
  const context = createRequestLogContext("api.subscriber.request-code", request);
  let email: string | undefined;

  logRequestStart(context, {
    contentType: request.headers.get("content-type"),
  });

  try {
    const payload = (await request.json()) as { email?: string };
    email = payload.email ?? "";

    await requestSubscriberSignInCode({
      email,
      requestIp: context.ip,
      requestUserAgent: request.headers.get("user-agent"),
    });

    logRequestSuccess(context, {
      email: maskEmail(email),
    });

    return jsonWithRequestId<RequestCodeResponse>(context, {
      success: true,
    });
  } catch (error) {
    if (error instanceof SubscriberError) {
      logRequestWarning(context, "Subscriber request-code rejected", {
        email: maskEmail(email),
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
      logRequestError(context, "Subscriber request-code route is not configured", error, {
        email: maskEmail(email),
      });

      return jsonWithRequestId(
        context,
        { error: "Subscriber sign-in is not configured yet. Set DATABASE_URL, SESSION_SECRET, RESEND_API_KEY, and RESEND_FROM_EMAIL." },
        { status: 500 },
      );
    }

    logRequestError(context, "Unexpected subscriber request-code failure", error, {
      email: maskEmail(email),
    });

    return jsonWithRequestId(
      context,
      { error: "Could not send a sign-in code right now." },
      { status: 500 },
    );
  }
}
