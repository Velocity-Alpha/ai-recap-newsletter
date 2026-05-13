import { NextResponse } from "next/server";

import { 
  createApprovalOutlineDataWithoutDedup,
} from "@/src/features/newsletter/curation.service";
import { checkBatchStatus } from "@/src/features/newsletter/openai-batch";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError, logServerInfo } from "@/src/server/observability";

function parseDateParam(value: string | null): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function GET(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const batchJobId = searchParams.get("batch_job_id");
  const date = parseDateParam(searchParams.get("date"));

  if (!batchJobId) {
    return NextResponse.json(
      { error: "Missing batch_job_id parameter." },
      { status: 400 }
    );
  }

  logServerInfo("approval.outline.status.check", { batchJobId, date: date.toISOString() });

  try {
    const batchStatus = await checkBatchStatus(batchJobId);

    // Handle processing states (queued, in_progress)
    if (
      batchStatus.status === "queued" ||
      batchStatus.status === "in_progress" ||
      batchStatus.status === "processing"
    ) {
      logServerInfo("approval.outline.status.processing", { batchJobId });
      return NextResponse.json({ status: "processing" });
    }

    // Handle failure states
    if (
      batchStatus.status === "failed" ||
      batchStatus.status === "expired" ||
      batchStatus.error
    ) {
      logServerError("approval.outline.status.failed", batchStatus.error, { batchJobId });
      return NextResponse.json(
        { 
          status: "error", 
          error: batchStatus.error || "Deduplication batch failed." 
        },
        { status: 500 }
      );
    }

    // Handle completion
    if (batchStatus.status === "completed" && batchStatus.result) {
      // Rebuild outline with deduped story IDs
      const { outline: baseOutline } = 
        await createApprovalOutlineDataWithoutDedup(date);

      const keptStoryIds = new Set<number>(batchStatus.result.kept_story_ids || []);

      // Filter candidate_sections to only include kept stories
      const deduped_sections = baseOutline.candidate_sections.map((section) => ({
        ...section,
        selected: section.selected.filter((s) => keptStoryIds.has(s.id)),
        fill_ins: section.fill_ins.filter((s) => keptStoryIds.has(s.id)),
      }));

      // Remove any stories from candidate_map that were deduped
      const deduped_map: Record<string, typeof baseOutline.candidate_map[string]> = {};
      for (const [key, story] of Object.entries(baseOutline.candidate_map)) {
        const id = parseInt(key, 10);
        if (keptStoryIds.has(id)) {
          deduped_map[key] = story;
        }
      }

      const deduped_selected_ids = baseOutline.selected_story_ids.filter((id) =>
        keptStoryIds.has(id)
      );

      logServerInfo("approval.outline.status.completed", { 
        batchJobId,
        keptCount: keptStoryIds.size,
        totalCount: baseOutline.selected_story_ids.length,
      });

      return NextResponse.json({
        status: "completed",
        outline: {
          reference_stories: baseOutline.reference_stories,
          candidate_sections: deduped_sections,
          candidate_map: deduped_map,
          selected_story_ids: deduped_selected_ids,
        },
      });
    }

    logServerError("approval.outline.status.unknown_state", batchStatus, { batchJobId });
    return NextResponse.json(
      { error: "Unknown batch status." },
      { status: 500 }
    );
  } catch (error) {
    logServerError("approval.outline.status.error", error, { batchJobId });

    return NextResponse.json(
      { error: "Failed to check batch status." },
      { status: 500 }
    );
  }
}
