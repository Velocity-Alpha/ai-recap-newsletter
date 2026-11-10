import { NextResponse } from "next/server";

import { readDateForBoard } from "@/src/pipeline/draft/draft-board";
import { parseCommitDate } from "@/src/pipeline/draft/outline";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError } from "@/src/server/observability";

export const runtime = "nodejs";

/** A date's state, current draft, and staged versions, for the board and the draft page (#149). */
export async function GET(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const date = parseCommitDate(new URL(request.url).searchParams.get("date"));
  if (!date) return NextResponse.json({ error: "Give a date as YYYY-MM-DD." }, { status: 400 });

  try {
    return NextResponse.json(await readDateForBoard(date), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logServerError("approval.drafts.list_failed", error, { date });
    return NextResponse.json({ error: "Could not read the drafts." }, { status: 500 });
  }
}
