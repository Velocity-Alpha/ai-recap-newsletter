import { NextResponse } from "next/server";

import { 
  createApprovalOutlineDataWithoutDedup 
} from "@/src/features/newsletter/curation.service";
import { submitDeduplicationBatch } from "@/src/features/newsletter/openai-batch";
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

    // Submit async dedup job to OpenAI
    let batchJobId: string | null = null;
    try {
      batchJobId = await submitDeduplicationBatch(
        {
          incomingStories: rankedCandidates.map((s) => ({
            id: s.id,
            headline: s.headline,
            summary: s.summary,
            story_details: s.story_details,
          })),
          referencedStories: referencedStories.map((s) => ({
            id: s.id,
            headline: s.headline,
            summary: s.summary,
            story_details: s.story_details,
          })),
        },
        dateKey
      );

      logServerInfo("approval.outline.api.batch_submitted", { 
        date: dateKey,
        batchJobId,
      });
    } catch (batchError) {
      logServerError("approval.outline.api.batch_submit_failed", batchError, { 
        date: dateKey,
      });
      // Continue without batch — outline is still valid, just not deduped
    }

    return NextResponse.json({
      status: batchJobId ? "pending" : "ready",
      batch_job_id: batchJobId,
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
