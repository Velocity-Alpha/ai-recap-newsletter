import { NextResponse } from "next/server";

import { getCachedTickerFeed } from "@/src/features/newsletter/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { data, stats, count } = await getCachedTickerFeed();

    return NextResponse.json(
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
    return NextResponse.json(
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
