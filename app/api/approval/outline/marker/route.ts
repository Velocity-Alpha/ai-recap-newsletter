import { NextResponse } from "next/server";

import { approvalDateKey } from "@/src/features/newsletter/approval-date";
import { getCandidateMarker } from "@/src/features/newsletter/curation.service";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError } from "@/src/server/observability";

/** The current candidate marker for a date. The board reads it to see if its cached copy missed newer stories. */
export async function GET(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const dateKey = approvalDateKey(new URL(request.url).searchParams.get("date"));

  try {
    const candidateMarker = await getCandidateMarker(new Date(dateKey));
    return NextResponse.json(
      { candidate_marker: candidateMarker },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    logServerError("approval.outline.marker.error", error, { date: dateKey });
    return NextResponse.json({ error: "Failed to read the candidate marker." }, { status: 500 });
  }
}
