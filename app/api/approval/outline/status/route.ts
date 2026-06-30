import { NextResponse } from "next/server";

import { 
  createOutlineCandidateStories,
} from "@/src/features/newsletter/curation.service";
import { checkDeduplicationStatus } from "@/src/features/newsletter/openai-dedup";
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
  const responseId = searchParams.get("response_id");
  const date = parseDateParam(searchParams.get("date"));

  if (!responseId) {
    return NextResponse.json(
      { error: "Missing response_id parameter." },
      { status: 400 }
    );
  }

  logServerInfo("approval.outline.status.check", { responseId, date: date.toISOString() });

  try {
    const responseStatus = await checkDeduplicationStatus(responseId);

    // Handle in-progress state
    if (responseStatus.status === "pending") {
      logServerInfo("approval.outline.status.processing", { responseId });
      return NextResponse.json({ status: "processing" });
    }

    // Handle failure states
    if (
      responseStatus.status === "failed" ||
      responseStatus.error
    ) {
      logServerError("approval.outline.status.failed", responseStatus.error, { responseId });
      return NextResponse.json(
        { 
          status: "error", 
          error: responseStatus.error || "Deduplication response failed." 
        },
        { status: 500 }
      );
    }

    // Handle completion
    if (responseStatus.status === "completed" && responseStatus.result) {
      // Rebuild outline with deduped story IDs
      const { outline: baseOutline } = 
        await createOutlineCandidateStories(date);

      const keptStoryIds = new Set<number>(responseStatus.result.kept_story_ids || []);

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
        responseId,
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

    logServerError("approval.outline.status.unknown_state", responseStatus, { responseId });
    return NextResponse.json(
      { error: "Unknown response status." },
      { status: 500 }
    );
  } catch (error) {
    logServerError("approval.outline.status.error", error, { responseId });

    return NextResponse.json(
      { error: "Failed to check response status." },
      { status: 500 }
    );
  }
}
