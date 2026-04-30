import { NextResponse } from "next/server";

import { createApprovalOutlineData } from "@/src/features/newsletter/curation.service";
import { hasValidApprovalSession } from "@/src/server/approval-auth";

function parseDateParam(value: string | null): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function GET(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = parseDateParam(searchParams.get("date"));

  console.log("[approval:outline] api.request", { date: date.toISOString() });

  const data = await createApprovalOutlineData(date);

  console.log("[approval:outline] api.ready", { date: date.toISOString() });

  return NextResponse.json(data);
}
