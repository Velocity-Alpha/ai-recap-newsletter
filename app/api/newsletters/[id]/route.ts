import { NextResponse } from "next/server";

import { getCachedNewsletterIssueApiResponseById } from "@/src/features/newsletter/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const issueId = Number.parseInt(id, 10);

    if (!Number.isFinite(issueId) || issueId <= 0) {
      return NextResponse.json(
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
      return NextResponse.json(
        {
          success: false,
          error: "Record not found",
          message: `No Record found with ID: ${issueId}`,
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
