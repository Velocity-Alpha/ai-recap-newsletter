import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
} from "@/src/server/observability";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = createRequestLogContext("api.newsletters.commit", request);

  logRequestStart(context, {
    contentType: request.headers.get("content-type"),
  });

  try {
    if (!(await hasValidApprovalSession(request))) {
      return jsonWithRequestId(context, { error: "Unauthorized." }, { status: 401 });
    }

    const payload = await request.json();

    // Validate JWT_SECRET exists
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not defined in environment variables");
    }

    const authClaims = {
      scope: "story-approval",
      payloadType: Array.isArray(payload) ? "array" : typeof payload,
      issuedFor: "n8n-story-approval-webhook",
    };

    // Sign a plain-object JWT for webhook authentication.
    const token = jwt.sign(authClaims, jwtSecret, {
      algorithm: "HS256",
      expiresIn: "1h", // Token expires in 1 hour
    });

    const webhookUrl =
      process.env.OUTLINE_COMMIT_WEBHOOK_URL ??
      "https://n8n.velocityalpha.com/webhook/story/approval";
    const webhookHostname = new URL(webhookUrl).hostname;
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      throw new Error(
        `Webhook returned ${webhookResponse.status}: ${errorText}`,
      );
    }

    const webhookData = await webhookResponse.json();

    logRequestSuccess(context, {
      hasPayload: payload !== null && payload !== undefined,
      payloadType: Array.isArray(payload) ? "array" : typeof payload,
      webhookStatus: webhookResponse.status,
      webhookHostname,
      forwardedSuccessfully: true,
    });

    return jsonWithRequestId(context, {
      success: true,
      message: "Outline committed to generation webhook.",
      receivedAt: new Date().toISOString(),
      webhookResponse: webhookData,
    });
  } catch (error) {
    logRequestError(context, "Outline commit workflow failed", error);

    return jsonWithRequestId(
      context,
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
