import { NextResponse } from "next/server";

import { createDedupedOutline } from "@/src/features/newsletter/curation.service";
import { checkDeduplicationStatus } from "@/src/features/newsletter/openai-dedup";
import { parseReuseDraftDates } from "@/src/features/newsletter/reuse-drafts-param";
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
  const reuseDraftDates = parseReuseDraftDates(searchParams.get("reuse"));

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

    // Handle completion: rebuild the board from kept stories so emptied slots refill.
    if (responseStatus.status === "completed" && responseStatus.result) {
      const keptStoryIds = responseStatus.result.kept_story_ids || [];
      const outline = await createDedupedOutline(date, keptStoryIds, { reuseDraftDates });

      logServerInfo("approval.outline.status.completed", {
        responseId,
        keptCount: keptStoryIds.length,
        selectedCount: outline.selected_story_ids.length,
      });

      return NextResponse.json({ status: "completed", outline });
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
