import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
} from "@/src/server/observability";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { fetchPublishedIssueOnOrBeforeDate } from "@/src/features/newsletter/repository";

export const runtime = "nodejs";

function parseDateOnly(value: string | null): string {
  const candidate = value ? new Date(value) : new Date();
  const date = Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const context = createRequestLogContext("api.newsletters.publish_status", request);
  logRequestStart(context);

  try {
    if (!(await hasValidApprovalSession(request))) {
      return jsonWithRequestId(context, { error: "Unauthorized." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const targetDate = parseDateOnly(searchParams.get("date"));
    const result = await fetchPublishedIssueOnOrBeforeDate(targetDate);

    logRequestSuccess(context, {
      targetDate,
      hasExactMatch: result.has_exact_match,
      hasIssue: Boolean(result.issue),
    });

    return jsonWithRequestId(context, {
      success: true,
      ...result,
    });
  } catch (error) {
    logRequestError(context, "Publish status lookup failed", error);

    return jsonWithRequestId(
      context,
      {
        success: false,
        error: "Failed to load publish status.",
      },
      { status: 500 }
    );
  }
}
