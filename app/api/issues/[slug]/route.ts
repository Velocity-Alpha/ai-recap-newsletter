import { getCachedNewsletterIssueApiResponseBySlug } from "@/src/features/newsletter/server";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
  logRequestWarning,
} from "@/src/server/observability";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const requestContext = createRequestLogContext("api.issues.by-slug", request);
  logRequestStart(requestContext);

  try {
    const { slug } = await context.params;
    const normalizedSlug = slug.trim();

    if (!normalizedSlug) {
      logRequestWarning(requestContext, "Missing slug parameter");

      return jsonWithRequestId(
        requestContext,
        {
          success: false,
          error: "Missing slug parameter",
          message: "Please provide a slug like: ?slug=my-issue",
        },
        { status: 400 },
      );
    }

    const data = await getCachedNewsletterIssueApiResponseBySlug(normalizedSlug);

    if (!data) {
      logRequestWarning(requestContext, "Issue not found by slug", {
        slug: normalizedSlug,
      });

      return jsonWithRequestId(
        requestContext,
        {
          success: false,
          error: "Record not found",
          message: `No record found with slug: ${normalizedSlug}`,
        },
        { status: 404 },
      );
    }

    logRequestSuccess(requestContext, {
      slug: normalizedSlug,
      issueId: data.id,
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
    logRequestError(requestContext, "Issue lookup by slug failed", error);

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
