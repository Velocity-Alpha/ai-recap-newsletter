import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const board = vi.hoisted(() => ({ readDateForBoard: vi.fn() }));
vi.mock("@/src/pipeline/draft/draft-board", () => board);

import { GET } from "@/app/api/approval/drafts/route";

const VIEW = {
  state: { kind: "staged", version: 2, changedSinceStaged: false },
  currentDraft: { id: 41, edited: true },
  stagedVersions: [
    {
      id: 9,
      version: 2,
      title: "Pretend Lab Plans A Week",
      stagedAt: "2026-05-21T14:00:00.000Z",
      serviceName: "Pretend Mail",
      serviceUrl: null,
      latest: true,
      sent: false,
    },
  ],
};

async function get(query: string, signedIn = true) {
  const token = await createApprovalSessionToken();
  const response = await GET(
    new Request(`http://localhost/api/approval/drafts${query}`, {
      headers: signedIn ? { Cookie: `approval_session=${token}` } : {},
    }),
  );
  return { response, json: await response.json() };
}

describe("GET /api/approval/drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    board.readDateForBoard.mockResolvedValue(VIEW);
  });

  it("needs the approval login", async () => {
    const { response } = await get("?date=2026-05-21", false);

    expect(response.status).toBe(401);
    expect(board.readDateForBoard).not.toHaveBeenCalled();
  });

  it("needs a YYYY-MM-DD date", async () => {
    const { response, json } = await get("?date=May-21");

    expect(response.status).toBe(400);
    expect(json.error).toContain("date");
  });

  it("gives the date's state, current draft, and staged versions", async () => {
    const { response, json } = await get("?date=2026-05-21");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(board.readDateForBoard).toHaveBeenCalledWith("2026-05-21");
    expect(json).toEqual(VIEW);
  });

  it("says so when the read fails, without the cause", async () => {
    board.readDateForBoard.mockRejectedValue(new Error("connection string leaked here"));

    const { response, json } = await get("?date=2026-05-21");

    expect(response.status).toBe(500);
    expect(json).toEqual({ error: "Could not read the drafts." });
  });
});
