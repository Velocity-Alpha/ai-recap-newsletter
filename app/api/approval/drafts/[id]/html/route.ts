import { NextResponse } from "next/server";

import { getDraftHtml } from "@/src/pipeline/draft/draft-store";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError } from "@/src/server/observability";
import { positiveIdParam, type IdRouteContext } from "@/src/server/route-params";

export const runtime = "nodejs";

const NEW_TAB_BASE = '<base target="_blank">';

/**
 * The email with `<base target="_blank">` first in its head, so its links open in a new tab: most sites refuse to
 * load inside the frame. For the preview only; the email saved for GHL stays as it is.
 */
function withLinksInNewTab(html: string): string {
  const opening = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html) ?? /<!doctype\b[^>]*>/i.exec(html);
  const at = opening ? opening.index + opening[0].length : 0;
  return `${html.slice(0, at)}${NEW_TAB_BASE}${html.slice(at)}`;
}

/**
 * A draft's email HTML, for the board's preview frame. The frame is sandboxed, and so is this response
 * (`Content-Security-Policy: sandbox`): no scripts, and no access to the board's origin. Links open a new tab.
 */
export async function GET(request: Request, context: IdRouteContext) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const draftId = await positiveIdParam(context);
  if (!draftId) return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });

  try {
    const html = await getDraftHtml(draftId);
    if (!html) return NextResponse.json({ error: `Draft ${draftId} has no email yet.` }, { status: 404 });
    return new Response(withLinksInNewTab(html), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "sandbox allow-popups allow-popups-to-escape-sandbox",
        "X-Frame-Options": "SAMEORIGIN",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logServerError("approval.drafts.html_failed", error, { draftId });
    return NextResponse.json({ error: "Could not read the draft." }, { status: 500 });
  }
}
