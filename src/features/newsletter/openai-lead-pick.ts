import OpenAI from "openai";

import { modelFields, type ModelOverrides, type ReasoningEffort } from "@/src/lib/reasoning-effort";
import type { LeadShortlistEntry } from "@/src/features/newsletter/lead-story";
import { logServerError, logServerInfo } from "@/src/server/observability";

/**
 * The AI lead pick (#58): after the duplicate check, gpt-6-luna chooses the lead story from the board's shortlist
 * with the owner's editorial rubric. It is its own call, not part of the duplicate check: the lead depends on the
 * board the check leaves, and the two judgments stay separately testable. The board shows the scored lead first
 * and swaps in this pick when it arrives, unless the owner has already edited the board.
 *
 * The rubric comes first and the day's stories last, so a rebuilt board can reuse OpenAI's cached prompt prefix.
 */

export const LEAD_PICK_MODEL = "gpt-6-luna";
/**
 * Low, from evals/results/lead-pick.md (30 runs over 10 archived boards). Effort does not change the pick: the AI
 * lead is the owner's lead in 15 of 30 runs at none and high and 16 of 30 at low and medium, against 9 of 30 for
 * the scored lead alone. Every effort is cheap ($0.000073 a call at none, $0.000116 at low); low was the effort
 * before the eval, and a one-run gap gives no reason to move.
 */
export const LEAD_PICK_EFFORT: ReasoningEffort = "low";

/** The part of the OpenAI client the lead pick uses, so tests and evals can pass their own. */
export interface LeadPickClient {
  responses: {
    create(request: never): Promise<{ id: string }>;
    retrieve(responseId: string): Promise<{
      status?: string | null;
      output_text?: string | null;
      error?: { message?: string | null } | null;
    }>;
  };
}

const defaultClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as LeadPickClient;

/** `model` and `effort` are for evals: production uses LEAD_PICK_MODEL and LEAD_PICK_EFFORT. */
export interface LeadPickOptions extends ModelOverrides {
  client?: LeadPickClient;
}

export const LEAD_PICK_INSTRUCTIONS = `You are the editor of AI Recap, a daily AI newsletter for people who follow AI closely. You choose the lead story: the one the issue's subject line is about.

The test: what will people interested in AI be talking about at the watercooler today?

What makes a strong lead, roughly in this order:
1. A frontier model launch from a major or frontier lab (OpenAI, Anthropic, Google DeepMind, Meta, xAI, DeepSeek, Mistral, Kimi/Moonshot, Qwen, z.ai, MiniMax, Tencent and similar).
2. A major product update that many people will use (for example a change to ChatGPT, Claude or Gemini that everyday users see).
3. A once-in-a-lifetime company event, such as the IPO of a leading AI lab, or a giant funding round.
4. A government policy that changes the direction of AI.
5. Anything else, including a big scandal.

How to weigh them:
- A one-time event beats one more step in a series. The IPO of the biggest AI lab beats a point release of a model line.
- Reach matters: a story that affects millions of people or developers beats one that matters to a niche (for example a cloud partnership that only matters if you use that cloud).
- A change people will see or use beats corporate finance news (a cut funding target, a valuation update). Only an IPO or a giant new round counts as a finance lead.
- Prefer stories with less doom and gloom when there is a comparable alternative. A security incident or scandal can still lead when it affects millions.
- Research leads only when it is groundbreaking, surprising or counterintuitive (for example a new scaling law). Ordinary papers never lead.
- A small product launch never leads. A Product Hunt item only leads if it is a major release.
- "sources" is how many newsletters covered the story. More coverage is a sign of a good story, but it does not decide on its own.
- Never choose a story that repeats one in recently_published.

First, list in repeated_story_ids every shortlist story about the same event as a recently_published headline, even when it is worded differently (for example "Anthropic Files For IPO" and "Anthropic Files To Go Public" are the same event). Then choose exactly one story from the rest of shortlist. Reply with its id and one short sentence on why it leads, written for the editor.`;

export interface LeadPickInput {
  shortlist: LeadShortlistEntry[];
  /** Headlines of stories already published (or held for an unsent draft), to avoid repeats. */
  recentlyPublished: string[];
}

export interface LeadPickResult {
  lead_story_id: number;
  reason: string;
}

/** The day's part of the prompt, after the fixed rubric. */
export function leadPickUserMessage(input: LeadPickInput): string {
  return JSON.stringify({
    recently_published: input.recentlyPublished,
    shortlist: input.shortlist.map((entry) => ({
      id: entry.id,
      headline: entry.headline,
      summary: entry.summary,
      section: entry.section,
      sources: entry.sources,
    })),
  });
}

/** Submits the lead pick in background mode and returns the response id to poll. */
export async function submitLeadPick(input: LeadPickInput, date: string, options: LeadPickOptions = {}): Promise<string> {
  const client = options.client ?? defaultClient;
  const request = {
    ...modelFields(options, { model: LEAD_PICK_MODEL, effort: LEAD_PICK_EFFORT }),
    instructions: LEAD_PICK_INSTRUCTIONS,
    input: leadPickUserMessage(input),
    background: true,
    store: true,
    text: {
      format: {
        type: "json_schema",
        name: "lead_pick",
        strict: true,
        schema: {
          type: "object",
          properties: {
            repeated_story_ids: { type: "array", items: { type: "integer" } },
            lead_story_id: { type: "integer" },
            reason: { type: "string" },
          },
          required: ["repeated_story_ids", "lead_story_id", "reason"],
          additionalProperties: false,
        },
      },
    },
  };
  const response = await client.responses.create(request as never);

  logServerInfo("openai.lead_pick.submit.success", {
    responseId: response.id,
    date,
    shortlistCount: input.shortlist.length,
  });
  return response.id;
}

function parseLeadPick(outputText: string): LeadPickResult | null {
  try {
    const parsed = JSON.parse(outputText) as Partial<LeadPickResult> & { repeated_story_ids?: unknown };
    if (!Number.isInteger(parsed.lead_story_id) || typeof parsed.reason !== "string") return null;
    // A lead the model itself flagged as a repeat is no pick at all.
    if (Array.isArray(parsed.repeated_story_ids) && parsed.repeated_story_ids.includes(parsed.lead_story_id)) return null;
    return { lead_story_id: parsed.lead_story_id as number, reason: parsed.reason.trim() };
  } catch {
    return null;
  }
}

/** Polls a submitted lead pick. */
export async function checkLeadPickStatus(
  responseId: string,
  options: { client?: LeadPickClient } = {}
): Promise<{ status: "pending" } | { status: "completed"; result: LeadPickResult } | { status: "failed"; error: string }> {
  const response = await (options.client ?? defaultClient).responses.retrieve(responseId);

  if (response.status === "queued" || response.status === "in_progress") return { status: "pending" };

  if (response.status === "completed") {
    const result = parseLeadPick(response.output_text || "");
    if (result) {
      logServerInfo("openai.lead_pick.result", { responseId, leadStoryId: result.lead_story_id });
      return { status: "completed", result };
    }
    logServerError("openai.lead_pick.parse_error", new Error("Unreadable lead pick."), { responseId });
    return { status: "failed", error: "The lead pick returned an unreadable answer." };
  }

  if (response.status === "failed" || response.status === "cancelled" || response.status === "incomplete") {
    const error = response.error?.message || `The lead pick ended as ${response.status}.`;
    logServerError("openai.lead_pick.failed", new Error(error), { responseId });
    return { status: "failed", error };
  }

  return { status: "pending" };
}
