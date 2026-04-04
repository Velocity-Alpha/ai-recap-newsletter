import { setSubscriberSessionCookie } from "@/src/features/subscriber/server";
import { verifySubscriberSignInCode, SubscriberError } from "@/src/features/subscriber/service";
import type { VerifyCodeResponse } from "@/src/features/subscriber/types";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
  logRequestWarning,
  maskEmail,
} from "@/src/server/observability";

export async function POST(request: Request) {
  const context = createRequestLogContext("api.subscriber.verify-code", request);
  let email: string | undefined;

  logRequestStart(context, {
    contentType: request.headers.get("content-type"),
  });

  try {
    const payload = (await request.json()) as { email?: string; code?: string };
    email = payload.email ?? "";
    const subscriber = await verifySubscriberSignInCode({
      email,
      code: payload.code ?? "",
    });

    const response = jsonWithRequestId<VerifyCodeResponse>(context, {
      success: true,
    });
    setSubscriberSessionCookie(response.cookies, subscriber);

    logRequestSuccess(context, {
      email: maskEmail(email),
      subscriberId: subscriber.id,
    });

    return response;
  } catch (error) {
    if (error instanceof SubscriberError) {
      logRequestWarning(context, "Subscriber verify-code rejected", {
        email: maskEmail(email),
        statusCode: error.statusCode,
        code: error.code,
        reason: error.message,
      });

      return jsonWithRequestId(
        context,
        { error: error.message },
        { status: error.statusCode },
      );
    }

    if (error instanceof Error && /not configured/i.test(error.message)) {
      logRequestError(context, "Subscriber verify-code route is not configured", error, {
        email: maskEmail(email),
      });

      return jsonWithRequestId(
        context,
        { error: "Subscriber sign-in is not configured yet. Set DATABASE_URL and SESSION_SECRET." },
        { status: 500 },
      );
    }

    logRequestError(context, "Unexpected subscriber verify-code failure", error, {
      email: maskEmail(email),
    });

    return jsonWithRequestId(
      context,
      { error: "Could not verify that code right now." },
      { status: 500 },
    );
  }
}
