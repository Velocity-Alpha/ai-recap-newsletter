import { NextResponse } from "next/server";

import { DraftNotRetryableError, IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { retryNativeDraft } from "@/src/pipeline/draft/native-commit";
import { readDraftOwner } from "@/src/pipeline/draft/outline-store";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError, logServerInfo } from "@/src/server/observability";
import { positiveIdParam, type IdRouteContext } from "@/src/server/route-params";

export const runtime = "nodejs";

/** "Retry" on the board: runs a failed (or stuck) draft again from the start, as the same version. */
export async function POST(request: Request, context: IdRouteContext) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const draftId = await positiveIdParam(context);
  if (!draftId) return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });

  try {
    if ((await readDraftOwner()) !== "native") {
      return NextResponse.json(
        { success: false, error: "draft.owner is n8n, so native drafting is off. Commit the outline again instead." },
        { status: 409 },
      );
    }

    const { draft, start } = await retryNativeDraft(draftId, { siteUrl: new URL(request.url).origin });
    logServerInfo("approval.drafts.retry", { draftId, version: draft.version, started: start.started });
    if (!start.started) return NextResponse.json({ success: false, error: start.error, draft }, { status: 502 });
    return NextResponse.json({ success: true, draft });
  } catch (error) {
    if (error instanceof DraftNotRetryableError || error instanceof IssuePublishedError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    logServerError("approval.drafts.retry_failed", error, { draftId });
    return NextResponse.json({ success: false, error: "Could not retry the draft." }, { status: 500 });
  }
}
