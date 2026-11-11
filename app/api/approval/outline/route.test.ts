import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const curationFns = vi.hoisted(() => ({
  createOutlineCandidateStories: vi.fn(),
}));

const leadPickFns = vi.hoisted(() => ({
  submitLeadPick: vi.fn(),
}));

vi.mock("@/src/features/newsletter/curation.service", () => curationFns);
vi.mock("@/src/features/newsletter/openai-lead-pick", () => leadPickFns);

import { GET } from "@/app/api/approval/outline/route";

const BASE_OUTLINE = {
  reference_stories: [],
  candidate_sections: [],
  candidate_map: {},
  selected_story_ids: [],
  repeats_removed: [],
};

const LEAD_OUTLINE = {
  ...BASE_OUTLINE,
  reference_stories: [{ id: 9, headline: "Anthropic Files For IPO" }],
  candidate_sections: [
    { key: "headlines", max: 3, selected: [{ id: 1, headline: "Story 1", summary: "S1" }], fill_ins: [] },
  ],
  candidate_map: {
    "1": { id: 1, headline: "Story 1", summary: "S1", importance_score: 4, source: "tldr", sources: ["tldr"] },
  },
  selected_story_ids: [1],
  proposed_lead_id: 1,
};

function outlineResult(outline: object) {
  return { outline, referencedStories: [], rankedCandidates: [] };
}

async function get(url: string) {
  const token = await createApprovalSessionToken();
  return GET(new Request(url, { headers: { Cookie: `approval_session=${token}` } }));
}

describe("GET /api/approval/outline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APPROVAL_LEAD_PICK;
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    leadPickFns.submitLeadPick.mockResolvedValue("resp_lead");
  });

  it("rejects requests without an approval session", async () => {
    const response = await GET(new Request("http://localhost/api/approval/outline"));
    const json = await response.json();

    expect(curationFns.createOutlineCandidateStories).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized.");
  });

  it("returns the board at once, with status ready", async () => {
    curationFns.createOutlineCandidateStories.mockResolvedValue(outlineResult(BASE_OUTLINE));

    const response = await get("http://localhost/api/approval/outline?date=2026-04-30");
    const json = await response.json();

    expect(curationFns.createOutlineCandidateStories).toHaveBeenCalledWith(new Date("2026-04-30"), { reuseDraftDates: [] });
    expect(response.status).toBe(200);
    expect(json).toEqual({ status: "ready", outline: BASE_OUTLINE, lead_response_id: null });
  });

  it("passes the unsent drafts to reuse from the reuse parameter", async () => {
    curationFns.createOutlineCandidateStories.mockResolvedValue(outlineResult(BASE_OUTLINE));

    await get("http://localhost/api/approval/outline?date=2026-04-30&reuse=2026-04-29,bad,2026-04-28");

    expect(curationFns.createOutlineCandidateStories).toHaveBeenCalledWith(new Date("2026-04-30"), {
      reuseDraftDates: ["2026-04-28", "2026-04-29"],
    });
  });

  it("returns 500 when outline fetch fails", async () => {
    curationFns.createOutlineCandidateStories.mockRejectedValue(new Error("DB unreachable"));

    const response = await get("http://localhost/api/approval/outline?date=2026-04-30");
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("Failed to load approval outline data.");
  });

  describe("the AI lead pick", () => {
    beforeEach(() => {
      curationFns.createOutlineCandidateStories.mockResolvedValue(outlineResult(LEAD_OUTLINE));
    });

    it("submits the pick with the board's shortlist and the recent headlines, and returns its id", async () => {
      const json = await (await get("http://localhost/api/approval/outline?date=2026-04-24")).json();

      expect(json.lead_response_id).toBe("resp_lead");
      expect(leadPickFns.submitLeadPick).toHaveBeenCalledWith(
        {
          shortlist: [{ id: 1, headline: "Story 1", summary: "S1", section: "headlines", sources: 1, score: 4 }],
          recentlyPublished: ["Anthropic Files For IPO"],
        },
        "2026-04-24"
      );
    });

    it("still returns the board when the pick cannot be submitted", async () => {
      leadPickFns.submitLeadPick.mockRejectedValue(new Error("OpenAI unreachable"));
      const res = await get("http://localhost/api/approval/outline?date=2026-04-24");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.outline).toEqual(LEAD_OUTLINE);
      expect(json.lead_response_id).toBeNull();
    });

    it("skips the pick when it is switched off or nothing can lead", async () => {
      process.env.APPROVAL_LEAD_PICK = "off";
      expect((await (await get("http://localhost/api/approval/outline?date=2026-04-24")).json()).lead_response_id).toBeNull();

      delete process.env.APPROVAL_LEAD_PICK;
      curationFns.createOutlineCandidateStories.mockResolvedValue(outlineResult({ ...LEAD_OUTLINE, candidate_sections: [] }));
      expect((await (await get("http://localhost/api/approval/outline?date=2026-04-24")).json()).lead_response_id).toBeNull();
      expect(leadPickFns.submitLeadPick).not.toHaveBeenCalled();
    });
  });
});
