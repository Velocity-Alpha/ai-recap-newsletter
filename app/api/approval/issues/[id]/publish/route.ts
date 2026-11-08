import { NextResponse } from "next/server";

import { refreshPublishedIssues } from "@/src/features/newsletter/cache";
import { manualPublish, previewManualPublish } from "@/src/pipeline/publish/manual-publish";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError, logServerInfo } from "@/src/server/observability";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const STATUS_CODES: Record<string, number> = {
  published: 200,
  ready: 200,
  already_published: 409,
  not_found: 404,
  no_email: 422,
  wrong_issue: 422,
};

async function issueIdFrom(context: Context): Promise<number | null> {
  const { id } = await context.params;
  const issueId = Number(id);
  return Number.isSafeInteger(issueId) && issueId > 0 ? issueId : null;
}

/** Shows what "Mark as published" would publish, for the inline confirm step. */
export async function GET(request: Request, context: Context) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const issueId = await issueIdFrom(context);
  if (!issueId) return NextResponse.json({ error: "Invalid issue id." }, { status: 400 });

  try {
    const preview = await previewManualPublish(issueId);
    return NextResponse.json({ preview });
  } catch (error) {
    logServerError("approval.issues.publish.preview_failed", error, { issueId });
    return NextResponse.json({ error: "Could not read the issue." }, { status: 500 });
  }
}

/** Publishes an unpublished draft now, from its stored email HTML. */
export async function POST(request: Request, context: Context) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const issueId = await issueIdFrom(context);
  if (!issueId) return NextResponse.json({ error: "Invalid issue id." }, { status: 400 });

  try {
    const result = await manualPublish(issueId, new Date());
    logServerInfo("approval.issues.publish", { issueId, outcome: result.outcome });
    if (result.outcome === "published") refreshSite(issueId);
    return NextResponse.json(result, { status: STATUS_CODES[result.outcome] ?? 500 });
  } catch (error) {
    logServerError("approval.issues.publish.failed", error, { issueId });
    return NextResponse.json({ error: "Could not publish the issue." }, { status: 500 });
  }
}

/** The issue is published either way. Without the refresh, the lists catch up within the hour. */
function refreshSite(issueId: number) {
  try {
    refreshPublishedIssues();
  } catch (error) {
    logServerError("approval.issues.publish.refresh_failed", error, { issueId });
  }
}
