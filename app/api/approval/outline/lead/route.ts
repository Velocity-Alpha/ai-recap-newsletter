import { NextResponse } from "next/server";

import { checkLeadPickStatus } from "@/src/features/newsletter/openai-lead-pick";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError } from "@/src/server/observability";

/** Polls the AI lead pick (#58) that /api/approval/outline/status started. The board applies the result itself. */
export async function GET(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const responseId = new URL(request.url).searchParams.get("response_id");
  if (!responseId) {
    return NextResponse.json({ error: "Missing response_id parameter." }, { status: 400 });
  }

  try {
    const status = await checkLeadPickStatus(responseId);
    if (status.status === "pending") return NextResponse.json({ status: "processing" });
    if (status.status === "failed") return NextResponse.json({ status: "error", error: status.error });
    return NextResponse.json({ status: "completed", lead_id: status.result.lead_story_id, reason: status.result.reason });
  } catch (error) {
    logServerError("approval.outline.lead_pick.check_failed", error, { responseId });
    // 200, not 500: a missing pick is not a board failure; the board keeps the scored lead.
    return NextResponse.json({ status: "error", error: "Failed to check the lead pick." });
  }
}
