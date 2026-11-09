import { NextResponse } from "next/server";

import {
  findSkippedDate,
  markSkippedDate,
  skippedDateProblem,
  unmarkSkippedDate,
} from "@/src/pipeline/checks/skipped-dates";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError, logServerInfo } from "@/src/server/observability";

export const runtime = "nodejs";

/** "No issue today" on the board (#52). Marks or unmarks a skipped date; the check job then skips it. */

const NOTE_MAX = 200;

const unauthorized = () => NextResponse.json({ error: "Unauthorized." }, { status: 401 });
const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

function dateParam(request: Request): string | null {
  return new URL(request.url).searchParams.get("date");
}

/** Whether the date is skipped, and whether the button can still change it. */
export async function GET(request: Request) {
  if (!(await hasValidApprovalSession(request))) return unauthorized();
  const date = dateParam(request);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("The date must be YYYY-MM-DD.");

  try {
    const skipped = await findSkippedDate(date);
    const reason = skippedDateProblem(date, new Date());
    return NextResponse.json({ date, skipped, canChange: reason === null, ...(reason && { reason }) });
  } catch (error) {
    logServerError("approval.skipped_dates.read_failed", error, { date });
    return NextResponse.json({ error: "Could not read the skipped date." }, { status: 500 });
  }
}

/** Marks the date as a skipped date: no issue that day. */
export async function POST(request: Request) {
  if (!(await hasValidApprovalSession(request))) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { date?: unknown; note?: unknown };
  const date = typeof body.date === "string" ? body.date : null;
  const problem = skippedDateProblem(date, new Date());
  if (problem || !date) return badRequest(problem ?? "The date must be YYYY-MM-DD.");
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  if (note && note.length > NOTE_MAX) return badRequest(`The note is longer than ${NOTE_MAX} characters.`);

  try {
    const skipped = await markSkippedDate(date, { note, createdBy: "approval" });
    logServerInfo("approval.skipped_dates.marked", { date });
    return NextResponse.json({ date, skipped });
  } catch (error) {
    logServerError("approval.skipped_dates.mark_failed", error, { date });
    return NextResponse.json({ error: "Could not save the skipped date." }, { status: 500 });
  }
}

/** Undoes a skipped date, until that day is over. */
export async function DELETE(request: Request) {
  if (!(await hasValidApprovalSession(request))) return unauthorized();
  const date = dateParam(request);
  const problem = skippedDateProblem(date, new Date());
  if (problem || !date) return badRequest(problem ?? "The date must be YYYY-MM-DD.");

  try {
    const undone = await unmarkSkippedDate(date);
    logServerInfo("approval.skipped_dates.undone", { date, undone });
    return NextResponse.json({ date, undone });
  } catch (error) {
    logServerError("approval.skipped_dates.undo_failed", error, { date });
    return NextResponse.json({ error: "Could not undo the skipped date." }, { status: 500 });
  }
}
