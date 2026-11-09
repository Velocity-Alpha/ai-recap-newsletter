import { NextResponse } from "next/server";

import { changeStageOwner } from "@/src/features/admin/change-stage-owner";
import { withAdminApi } from "@/src/server/admin-auth";
import { logServerError, logServerInfo } from "@/src/server/observability";

/** Changes one stage owner (ingest.owner, draft.owner, publish.owner) from /admin/settings. */
export const POST = withAdminApi(async (request, session) => {
  const body = (await request.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Send JSON with a key and a value." }, { status: 400 });
  }

  try {
    const result = await changeStageOwner({ key: body.key, value: body.value }, session);
    if (result.status === "invalid") return NextResponse.json({ error: result.reason }, { status: 400 });
    if (result.status === "unchanged" || result.status === "conflict") {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }

    const { key, from, to, by } = result;
    const change = { key, from, to, by, at: result.at.toISOString(), runId: result.runId.toString() };
    logServerInfo("admin.stage_switch.changed", { key: change.key, to: change.to, by: change.by, runId: change.runId });
    return NextResponse.json({ change });
  } catch (error) {
    logServerError("admin.stage_switch.failed", error, { key: String(body.key) });
    return NextResponse.json({ error: "Could not change the setting. Nothing was saved." }, { status: 500 });
  }
});
