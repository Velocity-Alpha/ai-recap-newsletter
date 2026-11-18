import { NextResponse } from "next/server";

import { newImageErrorResponse, writeSceneForDraft } from "@/src/pipeline/draft/new-image";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { approvalSessionLimitResponse } from "@/src/server/approval-session-limit";
import { logServerError, logServerWarn } from "@/src/server/observability";
import { RATE_LIMITS } from "@/src/server/rate-limit";
import { positiveIdParam, type IdRouteContext } from "@/src/server/route-params";

export const runtime = "nodejs";

/** "New image" scene chat: the owner's plain words become a scene prompt. One model call. The draft does not change. */
export async function POST(request: Request, context: IdRouteContext) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const draftId = await positiveIdParam(context);
  if (!draftId) return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });
  const tooMany = await approvalSessionLimitResponse(request, RATE_LIMITS.approvalSceneChat, "Too many scene chat messages this hour.");
  if (tooMany) return tooMany;

  try {
    const body = await request.json().catch(() => null);
    const reply = await writeSceneForDraft(draftId, body);
    return NextResponse.json(reply, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = newImageErrorResponse(error);
    if (known) {
      if (known.status >= 500) logServerWarn("approval.drafts.scene_chat_unavailable", { draftId, error: known.error });
      return NextResponse.json({ error: known.error }, { status: known.status });
    }
    logServerError("approval.drafts.scene_chat_failed", error, { draftId });
    return NextResponse.json({ error: "Could not write the scene." }, { status: 500 });
  }
}
