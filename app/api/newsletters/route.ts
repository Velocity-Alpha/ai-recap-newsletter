import { getCachedNewsletterListPage } from "@/src/features/newsletter/server";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
} from "@/src/server/observability";

export const runtime = "nodejs";

function parsePageParam(value: string | null) {
  const parsedValue = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsedValue) && parsedValue >= 1 ? parsedValue : 1;
}

function parseLimitParam(value: string | null) {
  const parsedValue = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsedValue) && parsedValue >= 1 ? parsedValue : 6;
}

export async function GET(request: Request) {
  const requestContext = createRequestLogContext("api.newsletters.list", request);
  logRequestStart(requestContext);

  try {
    const { searchParams } = new URL(request.url);
    const page = parsePageParam(searchParams.get("page"));
    const limit = parseLimitParam(searchParams.get("limit"));
    const { data, pagination } = await getCachedNewsletterListPage(page, limit);

    logRequestSuccess(requestContext, {
      page,
      limit,
      resultCount: data.length,
      totalCount: pagination.totalCount,
      totalPages: pagination.totalPages,
    });

    return jsonWithRequestId(
      requestContext,
      {
        success: true,
        data,
        pagination,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    logRequestError(requestContext, "Newsletter list query failed", error);

    return jsonWithRequestId(
      requestContext,
      {
        success: false,
        error: "Database query failed",
        details: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
