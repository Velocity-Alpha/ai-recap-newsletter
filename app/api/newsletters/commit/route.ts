import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
  type RequestLogContext,
} from "@/src/server/observability";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { fetchLastPublishedIssueDateOnOrBefore } from "@/src/features/newsletter/repository";
import { parseCommitDate, resolveCommitWebhook } from "@/src/pipeline/side-effects/commit-webhook";
import { normalizeOutline, type ApprovalOutline } from "@/src/pipeline/draft/outline";
import { readDraftOwner, saveOutline } from "@/src/pipeline/draft/outline-store";
import { IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { commitNativeDraft } from "@/src/pipeline/draft/native-commit";
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

    // `native` drafts here and never calls n8n (#79). `n8n` works exactly as before.
    const draftOwner = await readDraftOwner();

    // Validate N8N_WEBHOOK_JWT_SECRET exists
    const webhookSecret = process.env.N8N_WEBHOOK_JWT_SECRET ?? "";
    if (draftOwner === "n8n" && !webhookSecret) {
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

    const targetDate = parseCommitDate(normalizedPayload.date);
    if (!targetDate) {
      return jsonWithRequestId(
        context,
        { success: false, error: "Commit payload is missing a valid date." },
        { status: 400 }
      );
    }

    let webhookUrl = "";
    if (draftOwner === "n8n") {
      const webhook = resolveCommitWebhook(process.env);
      if (!webhook.ok) {
        return jsonWithRequestId(context, { success: false, error: webhook.error }, { status: 503 });
      }
      webhookUrl = webhook.url;
    }

    let outline: ApprovalOutline;
    try {
      outline = normalizeOutline(normalizedPayload, targetDate);
    } catch (err) {
      return jsonWithRequestId(
        context,
        { success: false, error: err instanceof Error ? err.message : "Invalid outline." },
        { status: 400 },
      );
    }

    const publishStatus = await fetchLastPublishedIssueDateOnOrBefore(targetDate);
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

    if (draftOwner === "native") {
      return await commitNative(context, outline, new URL(request.url).origin);
    }
    const savedOutline = await saveOutline(outline, draftOwner);

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

    const webhookHostname = new URL(webhookUrl).hostname;
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      // n8n gets the calendar date only, never the client's raw value.
      body: JSON.stringify({ ...normalizedPayload, date: targetDate }),
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
      outlineId: savedOutline.id.toString(),
      outlineHash: savedOutline.hash,
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

/**
 * Saves the outline, applies the story changes, and starts the draft job on this deploy. The board then follows
 * the draft. A draft whose job did not start is already marked failed, so the board can retry it.
 */
async function commitNative(
  context: RequestLogContext,
  outline: ApprovalOutline,
  siteUrl: string,
) {
  let result: Awaited<ReturnType<typeof commitNativeDraft>>;
  try {
    result = await commitNativeDraft(outline, { siteUrl });
  } catch (error) {
    if (!(error instanceof IssuePublishedError)) throw error;
    return jsonWithRequestId(
      context,
      { success: false, error: error.message, target_date: outline.date },
      { status: 409 },
    );
  }

  const { draft, start } = result;
  if (!start.started) {
    logRequestError(context, "Native draft job did not start", new Error(start.error), { draftId: draft.draftId });
    return jsonWithRequestId(
      context,
      { success: false, owner: "native", error: start.error, draft },
      { status: 502 },
    );
  }

  logRequestSuccess(context, {
    draftOwner: "native",
    outlineId: result.outlineId.toString(),
    outlineHash: result.outlineHash,
    draftId: draft.draftId,
    draftVersion: draft.version,
    storyChanges: result.storyChanges,
  });

  return jsonWithRequestId(context, {
    success: true,
    owner: "native",
    message: `Draft v${draft.version} for ${draft.issueDate} started.`,
    receivedAt: new Date().toISOString(),
    draft,
  });
}
