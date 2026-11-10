import { NextResponse } from "next/server";

import { readDraftForBoard } from "@/src/pipeline/draft/draft-board";
import { changeDraftTitle, draftEditErrorResponse } from "@/src/pipeline/draft/draft-edit";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError, logServerInfo } from "@/src/server/observability";
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

/**
 * The title change (#149): `{ title }` goes into the current draft and the issue, and the draft's email HTML is
 * built again. No new draft, and no call to the distribution service.
 */
export async function PATCH(request: Request, context: IdRouteContext) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const draftId = await positiveIdParam(context);
  if (!draftId) return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });
  const body: unknown = await request.json().catch(() => null);

  try {
    const draft = await changeDraftTitle(draftId, body);
    logServerInfo("approval.drafts.title_changed", { draftId, version: draft.version });
    return NextResponse.json({ success: true, title: draft.content.title });
  } catch (error) {
    const known = draftEditErrorResponse(error);
    if (known) return NextResponse.json({ success: false, error: known.error }, { status: known.status });
    logServerError("approval.drafts.title_change_failed", error, { draftId });
    return NextResponse.json({ success: false, error: "Could not change the title." }, { status: 500 });
  }
}
