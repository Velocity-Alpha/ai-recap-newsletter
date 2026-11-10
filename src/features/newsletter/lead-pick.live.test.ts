// Opt-in: replays the 10 archived commits through the real AI lead pick (gpt-6-luna) and reports how often it
// chose the reviewer's lead. Needs an OpenAI key and makes 10 calls:
//   LEAD_PICK_LIVE=1 OPENAI_API_KEY=... npx vitest run src/features/newsletter/lead-pick.live.test.ts
// The fixture holds headlines only. LEAD_PICK_SUMMARIES may name a JSON file of {id: summary} to add them.
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));
vi.mock("@/src/server/observability", () => ({ logServerInfo: vi.fn(), logServerError: vi.fn() }));

import archive from "@/src/features/newsletter/__fixtures__/archived-boards.json";
import { buildApprovalOutline, type ProcessedStory } from "@/src/features/newsletter/curation.service";
import { LEAD_SHORTLIST_SIZE, applyLeadPick, leadShortlist } from "@/src/features/newsletter/lead-story";
import { checkLeadPickStatus, submitLeadPick } from "@/src/features/newsletter/openai-lead-pick";

type ArchivedBoard = (typeof archive.boards)[number];

function summaries(): Map<number, string> {
  const path = process.env.LEAD_PICK_SUMMARIES;
  if (!path) return new Map();
  const byId = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  return new Map(Object.entries(byId).map(([id, summary]) => [Number(id), summary]));
}

function outlineFor(board: ArchivedBoard, summaryById: Map<number, string>) {
  const removed = new Set(board.removed_ids);
  const kept: ProcessedStory[] = board.ranked_pool
    .filter((entry) => !removed.has(entry.id))
    .map((entry, index, pool) => ({
      id: entry.id,
      guid: null,
      day: null,
      headline: entry.headline,
      summary: summaryById.get(entry.id) ?? "",
      story_details: "",
      category: entry.category,
      source: entry.sources[0] ?? null,
      sources: entry.sources,
      url: null,
      paywall_detected: entry.paywall as ProcessedStory["paywall_detected"],
      importance_score: entry.importance,
      keyword_score: 0,
      combined_score: pool.length - index,
    }));
  return buildApprovalOutline(kept, []);
}

async function pick(input: Parameters<typeof submitLeadPick>[0], date: string) {
  const id = await submitLeadPick(input, date);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await checkLeadPickStatus(id);
    if (status.status === "completed") return status.result;
    // A failed pick leaves the scored lead in place, as on the board.
    if (status.status === "failed") return { lead_story_id: -1, reason: `(failed: ${status.error})` };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Lead pick timed out.");
}

describe.skipIf(process.env.LEAD_PICK_LIVE !== "1")("AI lead pick on the archived commits (live)", () => {
  it("reports how often the AI pick matches the reviewer's lead", { timeout: 600_000 }, async () => {
    const summaryById = summaries();
    const headlineById = new Map(archive.boards.flatMap((b) => b.ranked_pool.map((e) => [e.id, e.headline] as const)));
    const lines: string[] = [];
    let aiHits = 0;
    let scoreHits = 0;

    for (const [index, board] of archive.boards.entries()) {
      const outline = outlineFor(board, summaryById);
      const shortlist = leadShortlist(outline, LEAD_SHORTLIST_SIZE);
      // Earlier archived leads stand in for "recently published": they ran in the days before.
      const recentlyPublished = archive.boards.slice(0, index).map((earlier) => headlineById.get(earlier.lead_id) ?? "");
      const result = await pick({ shortlist, recentlyPublished }, board.date);
      const picked = applyLeadPick(outline, { leadId: result.lead_story_id, reason: result.reason });

      const aiLead = picked.proposed_lead_id;
      aiHits += aiLead === board.lead_id ? 1 : 0;
      scoreHits += outline.proposed_lead_id === board.lead_id ? 1 : 0;
      const chosenOnShortlist = shortlist.some((entry) => entry.id === board.lead_id);
      lines.push(
        `${board.date} ${aiLead === board.lead_id ? "HIT " : "miss"} AI: ${headlineById.get(aiLead ?? -1)} | ` +
          `chosen: ${headlineById.get(board.lead_id)}${chosenOnShortlist ? "" : " (not on shortlist)"}\n` +
          `           why: ${result.reason}`
      );
    }

    console.info(`AI lead pick: ${aiHits} of 10 (score alone: ${scoreHits} of 10)\n${lines.join("\n")}`);
    expect(aiHits + scoreHits).toBeGreaterThanOrEqual(0);
  });
});
