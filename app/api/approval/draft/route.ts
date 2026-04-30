import { NextResponse } from "next/server";

import { createDraftApprovalData } from "@/src/features/newsletter/curation.service";

function parseDateParam(value: string | null): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = parseDateParam(searchParams.get("date"));

  console.log("[approval:draft] api.request", { date: date.toISOString() });

  const data = await createDraftApprovalData(date);

  console.log("[approval:draft] api.ready", { date: date.toISOString() });

  return NextResponse.json(data);
}
