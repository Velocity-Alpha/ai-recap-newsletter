import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const curationFns = vi.hoisted(() => ({
  createApprovalOutlineData: vi.fn(),
}));

vi.mock("@/src/features/newsletter/curation.service", () => curationFns);

import { GET } from "@/app/api/newsletters/outline/route";

describe("GET /api/newsletters/outline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
  });

  it("rejects requests without an approval session", async () => {
    const response = await GET(new Request("http://localhost/api/newsletters/outline"));
    const json = await response.json();

    expect(curationFns.createApprovalOutlineData).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized.");
  });

  it("returns outline data for authenticated requests", async () => {
    curationFns.createApprovalOutlineData.mockResolvedValue({
      reference_stories: [],
      candidate_sections: [],
      candidate_map: {},
      selected_story_ids: [],
    });
    const token = await createApprovalSessionToken("approval-secret");

    const response = await GET(
      new Request("http://localhost/api/newsletters/outline?date=bad-date", {
        headers: {
          Cookie: `approval_session=${token}`,
        },
      })
    );
    const json = await response.json();

    expect(curationFns.createApprovalOutlineData).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(json.candidate_sections).toEqual([]);
  });
});
