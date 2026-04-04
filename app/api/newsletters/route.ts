import { NextResponse } from "next/server";

import { getCachedNewsletterListPage } from "@/src/features/newsletter/server";

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
  try {
    const { searchParams } = new URL(request.url);
    const page = parsePageParam(searchParams.get("page"));
    const limit = parseLimitParam(searchParams.get("limit"));
    const { data, pagination } = await getCachedNewsletterListPage(page, limit);

    return NextResponse.json(
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
