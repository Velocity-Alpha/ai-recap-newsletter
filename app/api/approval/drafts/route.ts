import { NextResponse } from "next/server";

import { listDraftsForBoard } from "@/src/pipeline/draft/draft-board";
import { readDraftOwner } from "@/src/pipeline/draft/outline-store";
import { parseCommitDate } from "@/src/pipeline/side-effects/commit-webhook";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError } from "@/src/server/observability";

export const runtime = "nodejs";

/**
 * The drafts for a date, for the board (#79). While n8n drafts, it reads none, so the board works as before
 * (and does not depend on the issue_drafts table).
 */
export async function GET(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const date = parseCommitDate(new URL(request.url).searchParams.get("date"));
  if (!date) return NextResponse.json({ error: "Give a date as YYYY-MM-DD." }, { status: 400 });

  try {
    const owner = await readDraftOwner();
    const drafts = owner === "native" ? await listDraftsForBoard(date) : [];
    const nextVersion = Math.max(0, ...drafts.map((draft) => draft.version)) + 1;
    return NextResponse.json({ owner, drafts, nextVersion }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logServerError("approval.drafts.list_failed", error, { date });
    return NextResponse.json({ error: "Could not read the drafts." }, { status: 500 });
  }
}
