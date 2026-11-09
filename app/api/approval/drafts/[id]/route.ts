import { NextResponse } from "next/server";

import { readDraftForBoard } from "@/src/pipeline/draft/draft-board";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError } from "@/src/server/observability";
import { positiveIdParam, type IdRouteContext } from "@/src/server/route-params";

export const runtime = "nodejs";

/** One draft's status. The board polls it while the draft runs. */
export async function GET(request: Request, context: IdRouteContext) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const draftId = await positiveIdParam(context);
  if (!draftId) return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });

  try {
    const draft = await readDraftForBoard(draftId, new Date());
    if (!draft) return NextResponse.json({ error: `Draft ${draftId} does not exist.` }, { status: 404 });
    return NextResponse.json({ draft }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logServerError("approval.drafts.status_failed", error, { draftId });
    return NextResponse.json({ error: "Could not read the draft." }, { status: 500 });
  }
}
