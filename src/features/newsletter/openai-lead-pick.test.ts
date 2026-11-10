import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({ responses: { create: vi.fn(), retrieve: vi.fn() } }));
vi.mock("openai", () => ({ default: vi.fn(() => clientMock) }));
vi.mock("@/src/server/observability", () => ({ logServerInfo: vi.fn(), logServerError: vi.fn() }));

import {
  checkLeadPickStatus,
  LEAD_PICK_INSTRUCTIONS,
  leadPickUserMessage,
  submitLeadPick,
} from "@/src/features/newsletter/openai-lead-pick";

const INPUT = {
  shortlist: [
    { id: 7, headline: "Anthropic Files For IPO", summary: "S7", section: "headlines", sources: 1, score: 7 },
    { id: 9, headline: "OpenAI Ships GPT-6.1 Terra", summary: "S9", section: "tools", sources: 3, score: 9 },
  ],
  recentlyPublished: ["Google Introduces Gemini 4 Carbon"],
};

describe("AI lead pick", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the fixed rubric as instructions and the day's stories as input, without the score", async () => {
    clientMock.responses.create.mockResolvedValue({ id: "resp_lead", status: "queued" });

    await expect(submitLeadPick(INPUT, "2026-10-27")).resolves.toBe("resp_lead");

    const request = clientMock.responses.create.mock.calls[0][0];
    expect(request).toMatchObject({ model: "gpt-6-luna", background: true, instructions: LEAD_PICK_INSTRUCTIONS });
    // The repeats come first in the schema, so the model names them before it chooses.
    expect(request.text.format.schema.required).toEqual(["repeated_story_ids", "lead_story_id", "reason"]);
    expect(JSON.parse(request.input)).toEqual({
      recently_published: ["Google Introduces Gemini 4 Carbon"],
      shortlist: [
        { id: 7, headline: "Anthropic Files For IPO", summary: "S7", section: "headlines", sources: 1 },
        { id: 9, headline: "OpenAI Ships GPT-6.1 Terra", summary: "S9", section: "tools", sources: 3 },
      ],
    });
  });

  it("carries the owner's rules in the rubric", () => {
    for (const rule of ["watercooler", "one-time event", "doom and gloom", "groundbreaking", "even when it is worded differently"]) {
      expect(LEAD_PICK_INSTRUCTIONS).toContain(rule);
    }
    expect(leadPickUserMessage(INPUT)).not.toContain("score");
  });

  it("reads a completed pick", async () => {
    clientMock.responses.retrieve.mockResolvedValue({
      status: "completed",
      output_text: JSON.stringify({ repeated_story_ids: [], lead_story_id: 7, reason: " A once-in-a-lifetime IPO. " }),
    });

    await expect(checkLeadPickStatus("resp_lead")).resolves.toEqual({
      status: "completed",
      result: { lead_story_id: 7, reason: "A once-in-a-lifetime IPO." },
    });
  });

  it("fails a pick the model itself flagged as a repeat, so the scored lead stays", async () => {
    clientMock.responses.retrieve.mockResolvedValue({
      status: "completed",
      output_text: JSON.stringify({ repeated_story_ids: [7], lead_story_id: 7, reason: "IPO, though already published." }),
    });

    await expect(checkLeadPickStatus("resp_lead")).resolves.toMatchObject({ status: "failed" });
  });

  it("reports pending, failed and unreadable picks", async () => {
    clientMock.responses.retrieve.mockResolvedValueOnce({ status: "in_progress" });
    await expect(checkLeadPickStatus("r")).resolves.toEqual({ status: "pending" });

    clientMock.responses.retrieve.mockResolvedValueOnce({ status: "failed", error: { message: "boom" } });
    await expect(checkLeadPickStatus("r")).resolves.toEqual({ status: "failed", error: "boom" });

    clientMock.responses.retrieve.mockResolvedValueOnce({ status: "completed", output_text: "{\"reason\": 1}" });
    await expect(checkLeadPickStatus("r")).resolves.toMatchObject({ status: "failed" });
  });
});
