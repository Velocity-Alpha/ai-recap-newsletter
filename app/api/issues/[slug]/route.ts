import { NextResponse } from "next/server";

import { getCachedNewsletterIssueApiResponseBySlug } from "@/src/features/newsletter/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const normalizedSlug = slug.trim();

    if (!normalizedSlug) {
      return NextResponse.json(
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
      return NextResponse.json(
        {
          success: false,
          error: "Record not found",
          message: `No record found with slug: ${normalizedSlug}`,
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
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
    return NextResponse.json(
      {
        success: false,
        error: "Database error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
