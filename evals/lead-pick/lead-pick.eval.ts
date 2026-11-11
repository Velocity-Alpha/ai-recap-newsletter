// The AI lead pick (src/features/newsletter/openai-lead-pick.ts) on the 10 archived boards. evals/README.md.
import { expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));
vi.mock("@/src/server/observability", () => ({ logServerInfo: vi.fn(), logServerError: vi.fn() }));

import { boardStoryIds, headlineById, leadPickCases, type LeadPickCase } from "@/evals/lead-pick/boards";
import { scoreLeadPick, type LeadPickOutput } from "@/evals/lead-pick/score";
import { readOnlyQuery } from "@/evals/lib/dev-db";
import { evalSettings } from "@/evals/lib/settings";
import { runSweep, type RunContext } from "@/evals/lib/sweep";
import { applyLeadPick } from "@/src/features/newsletter/lead-story";
import { checkLeadPickStatus, LEAD_PICK_MODEL, submitLeadPick } from "@/src/features/newsletter/openai-lead-pick";

const POLL_MS = 1_000;
const MAX_WAIT_MS = 10 * 60 * 1000;

/** Summaries from the Neon dev branch (read-only), when DATABASE_URL is set. The fixture has headlines only. */
async function loadSummaries(): Promise<{ summaries: Map<number, string>; source: string }> {
  const ids = boardStoryIds();
  const rows = await readOnlyQuery<{ id: number; summary: string | null }>(
    "SELECT id, summary FROM newsletter.stories WHERE id = ANY($1::int[])",
    [ids]
  );
  if (rows === null) return { summaries: new Map(), source: "headlines only (DATABASE_URL not set)" };
  const summaries = new Map(rows.filter((row) => row.summary?.trim()).map((row) => [row.id, row.summary!.trim()]));
  return { summaries, source: `headlines and summaries: ${summaries.size} of ${ids.length} board stories have a summary on the Neon dev branch` };
}

async function pick(item: LeadPickCase, context: RunContext): Promise<LeadPickOutput> {
  const options = { client: context.client, model: context.config.model, effort: context.config.effort };
  const responseId = await submitLeadPick({ shortlist: item.shortlist, recentlyPublished: item.recentlyPublished }, item.date, options);
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const status = await checkLeadPickStatus(responseId, { client: context.client });
    if (status.status === "completed") {
      const board = applyLeadPick(item.outline, { leadId: status.result.lead_story_id, reason: status.result.reason });
      return { boardLeadId: board.proposed_lead_id ?? null, pickedId: status.result.lead_story_id };
    }
    // A failed pick leaves the scored lead in place, as on the board.
    if (status.status === "failed") return { boardLeadId: item.scoredLeadId, pickedId: null };
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("The lead pick did not finish in 10 minutes.");
}

it("lead pick: AI lead against the owner's lead", async () => {
  const settings = evalSettings({ model: LEAD_PICK_MODEL, efforts: ["none", "low", "medium", "high"], repeats: 3 });
  const { summaries, source } = await loadSummaries();
  const headlines = headlineById();

  const { rows, path } = await runSweep({
    task: "lead-pick",
    title: "Lead pick eval",
    notes: [
      "The AI lead pick on the 10 archived boards of 2026-10-22 to 2026-11-04 " +
        "(`src/features/newsletter/__fixtures__/archived-boards.json`). Ground truth: the lead the owner committed.",
      "AI lead = owner lead: the board's lead after the AI pick (a failed pick leaves the scored lead). " +
        "The shortlist and score-only rows do not depend on the model.",
      `Story text: ${source}.`,
      "Latency includes background-mode polling once a second.",
    ],
    settings,
    items: leadPickCases(summaries),
    id: (item) => item.date,
    run: pick,
    score: scoreLeadPick,
    raw: (outcome) => ({
      ownerLeadId: outcome.item.ownerLeadId,
      aiLeadId: outcome.output?.boardLeadId ?? null,
      pickedId: outcome.output?.pickedId ?? null,
      aiLeadHeadline: headlines.get(outcome.output?.boardLeadId ?? -1) ?? null,
      ownerLeadHeadline: headlines.get(outcome.item.ownerLeadId) ?? null,
    }),
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
