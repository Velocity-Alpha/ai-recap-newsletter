import { NextResponse } from "next/server";

import { createOutlineCandidateStories, type ApprovalOutlineData } from "@/src/features/newsletter/curation.service";
import { LEAD_SHORTLIST_SIZE, leadShortlist } from "@/src/features/newsletter/lead-story";
import { submitLeadPick } from "@/src/features/newsletter/openai-lead-pick";
import { approvalDateKey } from "@/src/features/newsletter/approval-date";
import { parseReuseDraftDates } from "@/src/features/newsletter/reuse-drafts-param";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError, logServerInfo } from "@/src/server/observability";

function parseDateParam(value: string | null): Date {
  return new Date(approvalDateKey(value));
}

function toDateOnlyIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Starts the AI lead pick on the board (#58). Best-effort: the board already carries the scored lead, so a pick
 * that is off, has nothing to choose from or cannot be submitted just leaves that lead in place.
 */
async function startLeadPick(outline: ApprovalOutlineData, date: Date): Promise<string | null> {
  if (process.env.APPROVAL_LEAD_PICK === "off") return null;
  const shortlist = leadShortlist(outline, LEAD_SHORTLIST_SIZE);
  if (shortlist.length === 0) return null;
  try {
    return await submitLeadPick(
      { shortlist, recentlyPublished: outline.reference_stories.map((story) => story.headline) },
      toDateOnlyIso(date)
    );
  } catch (error) {
    logServerError("approval.outline.lead_pick.submit_failed", error, { date: date.toISOString() });
    return null;
  }
}

/**
 * The board for a date, in one request: repeats are removed from the story matches ingestion stored (#90), so
 * there is no wait. The AI lead pick starts here; the board polls `/api/approval/outline/lead` for it.
 */
export async function GET(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = parseDateParam(searchParams.get("date"));
  const reuseDraftDates = parseReuseDraftDates(searchParams.get("reuse"));

  logServerInfo("approval.outline.api.request", { date: date.toISOString(), reuseDraftDates });

  try {
    const { outline, rankedCandidates } = await createOutlineCandidateStories(date, { reuseDraftDates });
    const leadResponseId = await startLeadPick(outline, date);

    logServerInfo("approval.outline.api.outline_ready", {
      date: toDateOnlyIso(date),
      storyCount: rankedCandidates.length,
      repeatsRemoved: outline.repeats_removed.length,
      leadResponseId,
    });

    return NextResponse.json({ status: "ready", outline, lead_response_id: leadResponseId });
  } catch (error) {
    logServerError("approval.outline.api.error", error, { date: date.toISOString() });

    return NextResponse.json(
      { error: "Failed to load approval outline data." },
      { status: 500 }
    );
  }
}
