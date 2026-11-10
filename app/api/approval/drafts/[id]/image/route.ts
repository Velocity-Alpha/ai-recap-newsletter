import { NextResponse } from "next/server";

import { newImageErrorResponse, chooseNewImage } from "@/src/pipeline/draft/new-image";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError, logServerInfo, logServerWarn } from "@/src/server/observability";
import { positiveIdParam, type IdRouteContext } from "@/src/server/route-params";

export const runtime = "nodejs";

/**
 * "New image" (#116, #149) "Use this image": `{ imageUrl, scenePrompt }` from "Generate" goes into the current
 * draft and the issue, and the draft's email HTML is built again (ADR 0004). No new draft, and no call to the
 * distribution service.
 */
export async function POST(request: Request, context: IdRouteContext) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const draftId = await positiveIdParam(context);
  if (!draftId) return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });
  const body: unknown = await request.json().catch(() => null);

  try {
    const draft = await chooseNewImage(draftId, body);
    logServerInfo("approval.drafts.new_image", { draftId, version: draft.version });
    return NextResponse.json({ success: true, featuredImageUrl: draft.featuredImageUrl });
  } catch (error) {
    const known = newImageErrorResponse(error);
    if (known) {
      if (known.status >= 500) logServerWarn("approval.drafts.new_image_unavailable", { draftId, error: known.error });
      return NextResponse.json({ success: false, error: known.error }, { status: known.status });
    }
    logServerError("approval.drafts.new_image_failed", error, { draftId });
    return NextResponse.json({ success: false, error: "Could not change the image." }, { status: 500 });
  }
}
