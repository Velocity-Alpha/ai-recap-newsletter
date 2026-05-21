import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
} from "@/src/server/observability";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { fetchPublishedIssueOnOrBeforeDate } from "@/src/features/newsletter/repository";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

function normalizeCommitPayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  if (Array.isArray(payload) && payload.length === 1) {
    const firstItem = payload[0];
    if (firstItem && typeof firstItem === "object" && !Array.isArray(firstItem)) {
      return firstItem as Record<string, unknown>;
    }
  }
  throw new Error("Approval commit payload must be a JSON object.");
}

function parseDateOnly(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const context = createRequestLogContext("api.newsletters.commit", request);

  logRequestStart(context, {
    contentType: request.headers.get("content-type"),
  });

  try {
    if (!(await hasValidApprovalSession(request))) {
      return jsonWithRequestId(context, { error: "Unauthorized." }, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonWithRequestId(
        context,
        { success: false, error: "Request body must be valid JSON." },
        { status: 400 }
      );
    }

    // Validate N8N_WEBHOOK_JWT_SECRET exists
    const webhookSecret = process.env.N8N_WEBHOOK_JWT_SECRET;
    if (!webhookSecret) {
      throw new Error("N8N_WEBHOOK_JWT_SECRET is not defined in environment variables");
    }

    let normalizedPayload: Record<string, unknown>;
    try {
      normalizedPayload = normalizeCommitPayload(payload);
    } catch (err) {
      return jsonWithRequestId(
        context,
        { success: false, error: err instanceof Error ? err.message : "Invalid payload." },
        { status: 400 }
      );
    }

    const targetDate = parseDateOnly(normalizedPayload.date);
    if (!targetDate) {
      return jsonWithRequestId(
        context,
        { success: false, error: "Commit payload is missing a valid date." },
        { status: 400 }
      );
    }

    const publishStatus = await fetchPublishedIssueOnOrBeforeDate(targetDate);
    if (publishStatus.has_exact_match) {
      return jsonWithRequestId(
        context,
        {
          success: false,
          error: `An issue is already published for this day - ${targetDate}.`,
          target_date: targetDate,
        },
        { status: 409 }
      );
    }

    const authClaims = {
      scope: "story-approval",
      payloadType: "object",
      issuedFor: "n8n-story-approval-webhook",
    };

    // Sign a plain-object JWT for webhook authentication.
    const token = jwt.sign(authClaims, webhookSecret, {
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
      body: JSON.stringify(normalizedPayload),
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      throw new Error(
        `Webhook returned ${webhookResponse.status}: ${errorText}`,
      );
    }

    const webhookData = await webhookResponse.json();

    logRequestSuccess(context, {
      hasPayload: true,
      payloadType: "object",
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
