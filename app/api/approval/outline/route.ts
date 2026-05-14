import { NextResponse } from "next/server";

import { 
  createApprovalOutlineDataWithoutDedup 
} from "@/src/features/newsletter/curation.service";
import { submitDeduplication } from "@/src/features/newsletter/openai-dedup";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError, logServerInfo } from "@/src/server/observability";

function parseDateParam(value: string | null): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toDateOnlyIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = parseDateParam(searchParams.get("date"));
  const dateKey = toDateOnlyIso(date);

  logServerInfo("approval.outline.api.request", { date: date.toISOString() });

  try {
    // Get outline without AI dedup (fast)
    const { outline, referencedStories, rankedCandidates } = 
      await createApprovalOutlineDataWithoutDedup(date);

    logServerInfo("approval.outline.api.outline_ready", { 
      date: dateKey,
      storyCount: rankedCandidates.length,
    });

    // Submit async dedup job to OpenAI Responses API
    let responseId: string | null = null;
    try {
      responseId = await submitDeduplication(
        {
          incomingStories: rankedCandidates
            .filter((s) => s.headline != null && s.summary != null)
            .map((s) => ({
              id: s.id,
              headline: s.headline!,
              summary: s.summary!,
              story_details: s.story_details,
            })),
          referencedStories: referencedStories
            .filter((s) => s.headline != null && s.summary != null)
            .map((s) => ({
              id: s.id,
              headline: s.headline!,
              summary: s.summary!,
              story_details: s.story_details,
            })),
        },
        dateKey
      );

      logServerInfo("approval.outline.api.response_submitted", { 
        date: dateKey,
        responseId,
      });
    } catch (submitError) {
      logServerError("approval.outline.api.response_submit_failed", submitError, { 
        date: dateKey,
      });
      // Continue without dedup — outline is still valid, just not deduplicated
    }

    return NextResponse.json({
      status: responseId ? "pending" : "ready",
      response_id: responseId,
      outline,
    });
  } catch (error) {
    logServerError("approval.outline.api.error", error, { date: date.toISOString() });

    return NextResponse.json(
      { error: "Failed to load approval outline data." },
      { status: 500 }
    );
  }
}
