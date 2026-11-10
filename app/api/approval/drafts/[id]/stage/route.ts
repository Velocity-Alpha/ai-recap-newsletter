import { NextResponse } from "next/server";

import { StageError, stageDraft, type StageRefusal } from "@/src/pipeline/distribution/stage-draft";
import { IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError, logServerInfo, logServerWarn } from "@/src/server/observability";
import { positiveIdParam, type IdRouteContext } from "@/src/server/route-params";

export const runtime = "nodejs";

const REFUSAL_STATUS: Record<StageRefusal, number> = {
  missing: 404,
  not_current: 409,
  not_ready: 409,
  staging_running: 409,
  already_staged: 409,
  service_failed: 502,
};

/**
 * "Stage for sending" (#149): copies the current draft into the distribution service as the next staged
 * version. Body `{ confirmRepeat?: boolean }`: true stages a draft again that has not changed since the newest
 * staged version. The whole call runs here, with no background job.
 */
export async function POST(request: Request, context: IdRouteContext) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const draftId = await positiveIdParam(context);
  if (!draftId) return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { confirmRepeat?: unknown } | null;
  const confirmRepeat = body?.confirmRepeat === true;

  try {
    const staged = await stageDraft(draftId, { confirmRepeat });
    logServerInfo("approval.drafts.stage", { draftId, stagedVersionId: staged.id, version: staged.version, mode: staged.mode });
    return NextResponse.json({ success: true, staged });
  } catch (error) {
    if (error instanceof IssuePublishedError) {
      return NextResponse.json({ success: false, code: "published", error: error.message }, { status: 409 });
    }
    if (error instanceof StageError) {
      if (error.code === "service_failed") logServerWarn("approval.drafts.stage_service_failed", { draftId, error: error.message });
      return NextResponse.json(
        { success: false, code: error.code, error: error.message, ...(error.version === undefined ? {} : { version: error.version }) },
        { status: REFUSAL_STATUS[error.code] },
      );
    }
    logServerError("approval.drafts.stage_failed", error, { draftId });
    return NextResponse.json({ success: false, error: "Could not stage the draft." }, { status: 500 });
  }
}
