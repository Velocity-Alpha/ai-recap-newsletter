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
import { normalizeOutline, parseCommitDate, type ApprovalOutline } from "@/src/pipeline/draft/outline";
import { IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { commitNativeDraft } from "@/src/pipeline/draft/native-commit";

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

    return await commitDraft(context, outline, new URL(request.url).origin);
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
async function commitDraft(
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
    logRequestError(context, "Draft job did not start", new Error(start.error), { draftId: draft.draftId });
    return jsonWithRequestId(
      context,
      { success: false, error: start.error, draft },
      { status: 502 },
    );
  }

  logRequestSuccess(context, {
    outlineId: result.outlineId.toString(),
    outlineHash: result.outlineHash,
    draftId: draft.draftId,
    draftVersion: draft.version,
    storyChanges: result.storyChanges,
  });

  return jsonWithRequestId(context, {
    success: true,
    message: `The draft for ${draft.issueDate} started.`,
    receivedAt: new Date().toISOString(),
    draft,
  });
}
