import {
  SubscriberError,
  unsubscribeSubscriberFromWebhook,
} from "@/src/features/subscriber/service";
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

function getWebhookSecret() {
  const secret = process.env.GHL_UNSUBSCRIBE_WEBHOOK_SECRET?.trim();

  if (!secret) {
    throw new Error("GHL_UNSUBSCRIBE_WEBHOOK_SECRET is not configured.");
  }

  return secret;
}

function isAuthorizedWebhookRequest(request: Request) {
  const expectedSecret = getWebhookSecret();
  const authorization = request.headers.get("authorization")?.trim();
  const headerSecret = request.headers.get("x-webhook-secret")?.trim();

  return authorization === `Bearer ${expectedSecret}` || headerSecret === expectedSecret;
}

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
  const context = createRequestLogContext("api.subscriber.unsubscribe.webhook", request);
  let email: string | null | undefined;

  logRequestStart(context, {
    contentType: request.headers.get("content-type"),
  });

  try {
    if (!isAuthorizedWebhookRequest(request)) {
      logRequestWarning(context, "Subscriber unsubscribe webhook rejected", {
        reason: "invalid_secret",
      });

      return jsonWithRequestId(
        context,
        { error: "Unauthorized." },
        { status: 401 },
      );
    }

    const payload = await getPayload(request);
    email = payload.email ?? null;
    await unsubscribeSubscriberFromWebhook({
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
      logRequestWarning(context, "Subscriber unsubscribe webhook rejected", {
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
      logRequestError(context, "Subscriber unsubscribe webhook is not configured", error, {
        email: maskEmail(email),
      });

      return jsonWithRequestId(
        context,
        {
          error:
            "Subscriber unsubscribe webhook is not configured yet. Set DATABASE_URL and GHL_UNSUBSCRIBE_WEBHOOK_SECRET.",
        },
        { status: 500 },
      );
    }

    logRequestError(context, "Unexpected subscriber unsubscribe webhook failure", error, {
      email: maskEmail(email),
    });

    return jsonWithRequestId(
      context,
      { error: "Could not unsubscribe that subscriber right now." },
      { status: 500 },
    );
  }
}
