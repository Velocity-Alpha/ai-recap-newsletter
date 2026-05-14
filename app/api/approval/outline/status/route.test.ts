import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const dedupFns = vi.hoisted(() => ({
  checkDeduplicationStatus: vi.fn(),
}));

const curationFns = vi.hoisted(() => ({
  createApprovalOutlineDataWithoutDedup: vi.fn(),
}));

vi.mock("@/src/features/newsletter/openai-dedup", () => dedupFns);
vi.mock("@/src/features/newsletter/curation.service", () => curationFns);

import { GET } from "@/app/api/approval/outline/status/route";

const BASE_URL = "http://localhost/api/approval/outline/status";

const RESPONSE_ID = "resp_abc123";
const DATE = "2026-04-24";

function makeRequest(params: Record<string, string>, token?: string) {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    headers: token ? { Cookie: `approval_session=${token}` } : {},
  });
}

const BASE_OUTLINE = {
  reference_stories: [],
  candidate_sections: [
    {
      topic: "AI",
      selected: [
        { id: 1, headline: "Story 1" },
        { id: 2, headline: "Story 2" },
      ],
      fill_ins: [{ id: 3, headline: "Story 3" }],
    },
  ],
  candidate_map: {
    "1": { id: 1, headline: "Story 1" },
    "2": { id: 2, headline: "Story 2" },
    "3": { id: 3, headline: "Story 3" },
  },
  selected_story_ids: [1, 2, 3],
};

describe("GET /api/approval/outline/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
  });

  it("rejects unauthenticated requests", async () => {
    const res = await GET(makeRequest({ response_id: RESPONSE_ID, date: DATE }));
    const json = await res.json();

    expect(dedupFns.checkDeduplicationStatus).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(json.error).toBe("Unauthorized.");
  });

  it("returns 400 when response_id is missing", async () => {
    const token = await createApprovalSessionToken("approval-secret");
    const res = await GET(makeRequest({ date: DATE }, token));
    const json = await res.json();

    expect(dedupFns.checkDeduplicationStatus).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(json.error).toBe("Missing response_id parameter.");
  });

  it("returns processing when response status is pending", async () => {
    dedupFns.checkDeduplicationStatus.mockResolvedValue({ status: "pending" });
    const token = await createApprovalSessionToken("approval-secret");

    const res = await GET(makeRequest({ response_id: RESPONSE_ID, date: DATE }, token));
    const json = await res.json();

    expect(dedupFns.checkDeduplicationStatus).toHaveBeenCalledWith(RESPONSE_ID);
    expect(res.status).toBe(200);
    expect(json.status).toBe("processing");
  });

  it("returns error when response status is failed", async () => {
    dedupFns.checkDeduplicationStatus.mockResolvedValue({
      status: "failed",
      error: "Response generation failed",
    });
    const token = await createApprovalSessionToken("approval-secret");

    const res = await GET(makeRequest({ response_id: RESPONSE_ID, date: DATE }, token));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.status).toBe("error");
    expect(json.error).toBe("Response generation failed");
  });

  it("returns error with fallback message when response fails without an error string", async () => {
    dedupFns.checkDeduplicationStatus.mockResolvedValue({ status: "failed" });
    const token = await createApprovalSessionToken("approval-secret");

    const res = await GET(makeRequest({ response_id: RESPONSE_ID, date: DATE }, token));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.status).toBe("error");
    expect(json.error).toBe("Deduplication response failed.");
  });

  it("returns completed outline filtered to kept story IDs", async () => {
    dedupFns.checkDeduplicationStatus.mockResolvedValue({
      status: "completed",
      result: { kept_story_ids: [1, 3] },
    });
    curationFns.createApprovalOutlineDataWithoutDedup.mockResolvedValue({
      outline: BASE_OUTLINE,
    });
    const token = await createApprovalSessionToken("approval-secret");

    const res = await GET(makeRequest({ response_id: RESPONSE_ID, date: DATE }, token));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("completed");

    const outline = json.outline;
    expect(outline.selected_story_ids).toEqual([1, 3]);
    // story 2 should be filtered out
    expect(outline.candidate_sections[0].selected).toHaveLength(1);
    expect(outline.candidate_sections[0].selected[0].id).toBe(1);
    expect(outline.candidate_sections[0].fill_ins).toHaveLength(1);
    expect(outline.candidate_sections[0].fill_ins[0].id).toBe(3);
    expect(Object.keys(outline.candidate_map)).toEqual(["1", "3"]);
  });

  it("returns 500 for unknown response status", async () => {
    dedupFns.checkDeduplicationStatus.mockResolvedValue({ status: "completed" }); // completed but no result
    curationFns.createApprovalOutlineDataWithoutDedup.mockResolvedValue({
      outline: BASE_OUTLINE,
    });
    const token = await createApprovalSessionToken("approval-secret");

    const res = await GET(makeRequest({ response_id: RESPONSE_ID, date: DATE }, token));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("Unknown response status.");
  });

  it("returns 500 when checkDeduplicationStatus throws", async () => {
    dedupFns.checkDeduplicationStatus.mockRejectedValue(new Error("OpenAI unreachable"));
    const token = await createApprovalSessionToken("approval-secret");

    const res = await GET(makeRequest({ response_id: RESPONSE_ID, date: DATE }, token));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to check response status.");
  });
});
