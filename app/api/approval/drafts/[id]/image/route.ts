import { NextResponse } from "next/server";

import { newImageErrorResponse, chooseNewImage } from "@/src/pipeline/draft/new-image";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError, logServerInfo, logServerWarn } from "@/src/server/observability";
import { positiveIdParam, type IdRouteContext } from "@/src/server/route-params";

export const runtime = "nodejs";

/**
 * "New image" (#116) "Use this image": `{ imageUrl, scenePrompt }` from "Generate" becomes the issue's next draft,
 * with this draft's content, new HTML, and a new GHL template (ADR 0002). The draft-issue job makes it.
 */
export async function POST(request: Request, context: IdRouteContext) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const draftId = await positiveIdParam(context);
  if (!draftId) return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });
  const body: unknown = await request.json().catch(() => null);

  try {
    const { draft, start } = await chooseNewImage(draftId, body, { siteUrl: new URL(request.url).origin });
    logServerInfo("approval.drafts.new_image", { sourceDraftId: draftId, draftId: draft.draftId, version: draft.version, started: start.started });
    if (!start.started) return NextResponse.json({ success: false, error: start.error, draft }, { status: 502 });
    return NextResponse.json({ success: true, draft });
  } catch (error) {
    const known = newImageErrorResponse(error);
    if (known) {
      if (known.status >= 500) logServerWarn("approval.drafts.new_image_unavailable", { draftId, error: known.error });
      return NextResponse.json({ success: false, error: known.error }, { status: known.status });
    }
    logServerError("approval.drafts.new_image_failed", error, { draftId });
    return NextResponse.json({ success: false, error: "Could not make the new draft." }, { status: 500 });
  }
}
