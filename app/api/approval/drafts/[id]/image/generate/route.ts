import { NextResponse } from "next/server";

import { generateImageForDraft, newImageErrorResponse } from "@/src/pipeline/draft/new-image";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { approvalSessionLimitResponse } from "@/src/server/approval-session-limit";
import { logServerError, logServerInfo, logServerWarn } from "@/src/server/observability";
import { RATE_LIMITS } from "@/src/server/rate-limit";
import { positiveIdParam, type IdRouteContext } from "@/src/server/route-params";

export const runtime = "nodejs";

/**
 * "New image" (#116) "Generate": one image from `{ scenePrompt }` plus the fixed style prompt, uploaded to S3.
 * It makes no draft; "Use this image" (POST ../image) does.
 */
export async function POST(request: Request, context: IdRouteContext) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const draftId = await positiveIdParam(context);
  if (!draftId) return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });
  const tooMany = await approvalSessionLimitResponse(request, RATE_LIMITS.approvalImageGenerate, "Too many images this hour.");
  if (tooMany) return tooMany;
  const body: unknown = await request.json().catch(() => null);

  try {
    const image = await generateImageForDraft(draftId, body);
    logServerInfo("approval.drafts.image_generated", { draftId, imageUrl: image.imageUrl });
    return NextResponse.json({ image }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = newImageErrorResponse(error);
    if (known) {
      if (known.status >= 500) logServerWarn("approval.drafts.image_unavailable", { draftId, error: known.error });
      return NextResponse.json({ error: known.error }, { status: known.status });
    }
    logServerError("approval.drafts.image_failed", error, { draftId });
    return NextResponse.json({ error: "Could not make the image." }, { status: 500 });
  }
}
