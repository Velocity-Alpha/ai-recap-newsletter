import { getCachedNewsletterIssueApiResponseById } from "@/features/newsletter/server";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
  logRequestWarning,
} from "@/server/observability";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestContext = createRequestLogContext("api.newsletters.by-id", request);
  logRequestStart(requestContext);

  try {
    const { id } = await context.params;
    const issueId = Number.parseInt(id, 10);

    if (!Number.isFinite(issueId) || issueId <= 0) {
      logRequestWarning(requestContext, "Invalid issue ID", {
        id,
      });

      return jsonWithRequestId(
        requestContext,
        {
          success: false,
          error: "Invalid ID",
          message: "ID must be a positive number",
        },
        { status: 400 },
      );
    }

    const data = await getCachedNewsletterIssueApiResponseById(issueId);

    if (!data) {
      logRequestWarning(requestContext, "Issue not found by ID", {
        issueId,
      });

      return jsonWithRequestId(
        requestContext,
        {
          success: false,
          error: "Record not found",
          message: `No Record found with ID: ${issueId}`,
        },
        { status: 404 },
      );
    }

    logRequestSuccess(requestContext, {
      issueId,
      slug: data.slug,
    });

    return jsonWithRequestId(
      requestContext,
      {
        success: true,
        data,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    logRequestError(requestContext, "Issue lookup by ID failed", error);

    return jsonWithRequestId(
      requestContext,
      {
        success: false,
        error: "Database error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
