import { NextResponse } from "next/server";

import { newImageErrorResponse, suggestIdeasForDraft } from "@/src/pipeline/draft/new-image";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { approvalSessionLimitResponse } from "@/src/server/approval-session-limit";
import { logServerError, logServerWarn } from "@/src/server/observability";
import { RATE_LIMITS } from "@/src/server/rate-limit";
import { positiveIdParam, type IdRouteContext } from "@/src/server/route-params";

export const runtime = "nodejs";

/** "New image" (#116): three scene ideas from a ready draft's subject line and top stories. One model call. */
export async function POST(request: Request, context: IdRouteContext) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const draftId = await positiveIdParam(context);
  if (!draftId) return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });
  const tooMany = await approvalSessionLimitResponse(request, RATE_LIMITS.approvalImageIdeas, "Too many scene idea requests this hour.");
  if (tooMany) return tooMany;

  try {
    const ideas = await suggestIdeasForDraft(draftId);
    return NextResponse.json({ ideas }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = newImageErrorResponse(error);
    if (known) {
      if (known.status >= 500) logServerWarn("approval.drafts.image_ideas_unavailable", { draftId, error: known.error });
      return NextResponse.json({ error: known.error }, { status: known.status });
    }
    logServerError("approval.drafts.image_ideas_failed", error, { draftId });
    return NextResponse.json({ error: "Could not suggest scene ideas." }, { status: 500 });
  }
}
