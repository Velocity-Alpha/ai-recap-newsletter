import { getCachedTickerFeed } from "@/src/features/newsletter/server";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
} from "@/src/server/observability";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestContext = createRequestLogContext("api.ticker", request);
  logRequestStart(requestContext);

  try {
    const { data, stats, count } = await getCachedTickerFeed();

    logRequestSuccess(requestContext, {
      count,
      stats,
    });

    return jsonWithRequestId(
      requestContext,
      {
        success: true,
        data,
        stats,
        count,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
        },
      },
    );
  } catch (error) {
    logRequestError(requestContext, "Ticker query failed", error);

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
