import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const board = vi.hoisted(() => ({ readDraftForBoard: vi.fn() }));
vi.mock("@/src/pipeline/draft/draft-board", () => board);

import { GET } from "@/app/api/approval/drafts/[id]/route";

async function get(id: string, signedIn = true) {
  const token = await createApprovalSessionToken();
  const response = await GET(
    new Request(`http://localhost/api/approval/drafts/${id}`, {
      headers: signedIn ? { Cookie: `approval_session=${token}` } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, json: await response.json() };
}

describe("GET /api/approval/drafts/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
  });

  it("needs the approval login", async () => {
    const { response } = await get("41", false);

    expect(response.status).toBe(401);
    expect(board.readDraftForBoard).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a number", async () => {
    const { response } = await get("abc");

    expect(response.status).toBe(400);
    expect(board.readDraftForBoard).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing draft", async () => {
    board.readDraftForBoard.mockResolvedValue(null);

    const { response } = await get("41");

    expect(response.status).toBe(404);
  });

  it("returns the draft's status for polling, never cached", async () => {
    board.readDraftForBoard.mockResolvedValue({ id: 41, status: "running", stepLabel: "writing" });

    const { response, json } = await get("41");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(board.readDraftForBoard).toHaveBeenCalledWith(41, expect.any(Date));
    expect(json).toEqual({ draft: { id: 41, status: "running", stepLabel: "writing" } });
  });
});
