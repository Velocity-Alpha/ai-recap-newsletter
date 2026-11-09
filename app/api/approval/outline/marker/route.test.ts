import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFns = vi.hoisted(() => ({ hasValidApprovalSession: vi.fn() }));
const curationFns = vi.hoisted(() => ({ getCandidateMarker: vi.fn() }));

vi.mock("@/src/server/approval-auth", () => authFns);
vi.mock("@/src/features/newsletter/curation.service", () => curationFns);

import { GET } from "@/app/api/approval/outline/marker/route";

describe("GET /api/approval/outline/marker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authFns.hasValidApprovalSession.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects requests without an approval session", async () => {
    authFns.hasValidApprovalSession.mockResolvedValue(false);

    const response = await GET(new Request("http://localhost/api/approval/outline/marker?date=2026-11-09"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(curationFns.getCandidateMarker).not.toHaveBeenCalled();
  });

  it("returns the current candidate marker for the date", async () => {
    curationFns.getCandidateMarker.mockResolvedValue(812);

    const response = await GET(new Request("http://localhost/api/approval/outline/marker?date=2026-11-09"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ candidate_marker: 812 });
    expect(curationFns.getCandidateMarker).toHaveBeenCalledWith(new Date("2026-11-09"));
  });

  it("returns null when no story is in the window", async () => {
    curationFns.getCandidateMarker.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/approval/outline/marker?date=2026-11-09"));

    expect(await response.json()).toEqual({ candidate_marker: null });
  });

  it("uses today in New York without a date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T04:30:00.000Z"));
    curationFns.getCandidateMarker.mockResolvedValue(812);

    await GET(new Request("http://localhost/api/approval/outline/marker"));

    expect(curationFns.getCandidateMarker).toHaveBeenCalledWith(new Date("2026-11-08"));
  });

  it("returns 500 when the read fails", async () => {
    curationFns.getCandidateMarker.mockRejectedValue(new Error("DB unreachable"));

    const response = await GET(new Request("http://localhost/api/approval/outline/marker?date=2026-11-09"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to read the candidate marker." });
  });
});
