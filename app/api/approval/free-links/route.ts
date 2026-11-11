import { NextResponse } from "next/server";

import { prismaFreeLinksStore } from "@/src/pipeline/free-links/find-free-links";
import { readFreeLinks } from "@/src/pipeline/free-links/read-free-links";
import { MAX_STORY_IDS, readStoryIds, startFreeLinksJob } from "@/src/pipeline/free-links/start-free-links";
import { hasValidApprovalSession } from "@/src/server/approval-auth";
import { logServerError } from "@/src/server/observability";

export const runtime = "nodejs";

const BAD_IDS = `Give 1 to ${MAX_STORY_IDS} story ids.`;

/**
 * Starts the search for free links (#59) for the board's stories with a paywalled link. Only the stories that
 * were not searched before go to the background function, so a second call for the same stories starts nothing.
 */
export async function POST(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { story_ids?: unknown } | null;
  const storyIds = readStoryIds(body?.story_ids);
  if (!storyIds || storyIds.length === 0) {
    return NextResponse.json({ error: BAD_IDS }, { status: 400 });
  }

  try {
    const waiting = (await prismaFreeLinksStore.storiesToSearch(storyIds)).map((story) => story.id);
    if (waiting.length === 0) return NextResponse.json({ started: 0 });
    const result = await startFreeLinksJob(waiting, { siteUrl: new URL(request.url).origin });
    if (result.status !== "started") throw new Error(result.reason);
    return NextResponse.json({ started: waiting.length });
  } catch (error) {
    logServerError("approval.free_links.start_failed", error, { stories: storyIds.length });
    return NextResponse.json({ error: "The search for free links did not start." }, { status: 502 });
  }
}

/** The free links found so far, by story id. The board polls this while a search runs. */
export async function GET(request: Request) {
  if (!(await hasValidApprovalSession(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const ids = new URL(request.url).searchParams.get("ids") ?? "";
  const storyIds = readStoryIds(ids.split(",").map((id) => (/^\d+$/.test(id) ? Number(id) : id)));
  if (!storyIds || storyIds.length === 0) {
    return NextResponse.json({ error: BAD_IDS }, { status: 400 });
  }

  try {
    return NextResponse.json({ stories: await readFreeLinks(storyIds) });
  } catch (error) {
    logServerError("approval.free_links.read_failed", error, { stories: storyIds.length });
    return NextResponse.json({ error: "The free links could not be read." }, { status: 500 });
  }
}
