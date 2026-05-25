import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const repositoryFns = vi.hoisted(() => ({
  fetchLastPublishedIssueDateOnOrBefore: vi.fn(),
}));

vi.mock("@/src/features/newsletter/repository", () => repositoryFns);

import { GET } from "@/app/api/newsletters/publish-status/route";

describe("GET /api/newsletters/publish-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({
      target_date: "2026-05-21",
      has_exact_match: false,
      issue: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects requests without an approval session", async () => {
    const response = await GET(
      new Request("http://localhost/api/newsletters/publish-status?date=2026-05-21")
    );
    const responseBody = await response.json();

    expect(response.status).toBe(401);
    expect(responseBody.error).toBe("Unauthorized.");
    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).not.toHaveBeenCalled();
  });

  it("returns publish status for authenticated requests", async () => {
    const token = await createApprovalSessionToken("approval-secret");
    repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({
      target_date: "2026-05-21",
      has_exact_match: true,
      issue: {
        id: "42",
        slug: "issue-42",
        title: "Issue 42",
        issue_date: "2026-05-21T00:00:00.000Z",
        published_at: "2026-05-21T11:30:00.000Z",
      },
    });

    const response = await GET(
      new Request("http://localhost/api/newsletters/publish-status?date=2026-05-21", {
        headers: { Cookie: `approval_session=${token}` },
      })
    );
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).toHaveBeenCalledWith("2026-05-21");
    expect(responseBody).toMatchObject({
      success: true,
      target_date: "2026-05-21",
      has_exact_match: true,
      issue: {
        id: "42",
        slug: "issue-42",
        title: "Issue 42",
        issue_date: "2026-05-21T00:00:00.000Z",
        published_at: "2026-05-21T11:30:00.000Z",
      },
    });
  });

  it("normalizes date input and falls back to today for invalid dates", async () => {
    const token = await createApprovalSessionToken("approval-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T10:00:00.000Z"));

    await GET(
      new Request(
        "http://localhost/api/newsletters/publish-status?date=2026-05-21T17:45:00.000Z",
        {
          headers: { Cookie: `approval_session=${token}` },
        }
      )
    );
    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).toHaveBeenNthCalledWith(
      1,
      "2026-05-21"
    );

    await GET(
      new Request("http://localhost/api/newsletters/publish-status?date=not-a-date", {
        headers: { Cookie: `approval_session=${token}` },
      })
    );
    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).toHaveBeenNthCalledWith(
      2,
      "2026-05-25"
    );

    await GET(
      new Request("http://localhost/api/newsletters/publish-status", {
        headers: { Cookie: `approval_session=${token}` },
      })
    );
    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).toHaveBeenNthCalledWith(
      3,
      "2026-05-25"
    );
  });
});
