import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const curationFns = vi.hoisted(() => ({
  createOutlineCandidateStories: vi.fn(),
}));

const dedupFns = vi.hoisted(() => ({
  submitDeduplication: vi.fn(),
}));

vi.mock("@/src/features/newsletter/curation.service", () => curationFns);
vi.mock("@/src/features/newsletter/openai-dedup", () => dedupFns);

import { GET } from "@/app/api/approval/outline/route";

const BASE_OUTLINE = {
  reference_stories: [],
  candidate_sections: [],
  candidate_map: {},
  selected_story_ids: [],
};

describe("GET /api/approval/outline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
  });

  it("rejects requests without an approval session", async () => {
    const response = await GET(new Request("http://localhost/api/approval/outline"));
    const json = await response.json();

    expect(curationFns.createOutlineCandidateStories).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized.");
  });

  it("returns status=pending with response_id when dedup response is submitted", async () => {
    curationFns.createOutlineCandidateStories.mockResolvedValue({
      outline: BASE_OUTLINE,
      referencedStories: [],
      rankedCandidates: [],
    });
    dedupFns.submitDeduplication.mockResolvedValue("resp_abc123");
    const token = await createApprovalSessionToken("approval-secret");

    const response = await GET(
      new Request("http://localhost/api/approval/outline?date=2026-04-30", {
        headers: { Cookie: `approval_session=${token}` },
      })
    );
    const json = await response.json();

    expect(curationFns.createOutlineCandidateStories).toHaveBeenCalledWith(
      new Date("2026-04-30")
    );
    expect(response.status).toBe(200);
    expect(json.status).toBe("pending");
    expect(json.response_id).toBe("resp_abc123");
    expect(json.outline).toEqual(BASE_OUTLINE);
  });

  it("returns status=ready when dedup submission fails", async () => {
    curationFns.createOutlineCandidateStories.mockResolvedValue({
      outline: BASE_OUTLINE,
      referencedStories: [],
      rankedCandidates: [],
    });
    dedupFns.submitDeduplication.mockRejectedValue(new Error("OpenAI unavailable"));
    const token = await createApprovalSessionToken("approval-secret");

    const response = await GET(
      new Request("http://localhost/api/approval/outline?date=2026-04-30", {
        headers: { Cookie: `approval_session=${token}` },
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe("ready");
    expect(json.response_id).toBeNull();
    expect(json.outline).toEqual(BASE_OUTLINE);
  });

  it("returns 500 when outline fetch fails", async () => {
    curationFns.createOutlineCandidateStories.mockRejectedValue(
      new Error("DB unreachable")
    );
    const token = await createApprovalSessionToken("approval-secret");

    const response = await GET(
      new Request("http://localhost/api/approval/outline?date=2026-04-30", {
        headers: { Cookie: `approval_session=${token}` },
      })
    );
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("Failed to load approval outline data.");
  });
});
