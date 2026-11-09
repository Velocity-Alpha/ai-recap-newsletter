import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const board = vi.hoisted(() => ({ listDraftsForBoard: vi.fn() }));
vi.mock("@/src/pipeline/draft/draft-board", () => board);

const outlineStore = vi.hoisted(() => ({ readDraftOwner: vi.fn() }));
vi.mock("@/src/pipeline/draft/outline-store", () => outlineStore);

import { GET } from "@/app/api/approval/drafts/route";

const ENTRY = {
  id: 41,
  version: 2,
  status: "running",
  subject: null,
  failedStepLabel: null,
  ghlTemplateId: null,
  ghlPreviewUrl: null,
  sent: false,
  current: false,
  createdAt: "2026-05-21T14:00:00.000Z",
};

async function get(query: string, signedIn = true) {
  const token = await createApprovalSessionToken("approval-secret");
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
    outlineStore.readDraftOwner.mockResolvedValue("native");
    board.listDraftsForBoard.mockResolvedValue([ENTRY, { ...ENTRY, id: 40, version: 1 }]);
  });

  it("needs the approval login", async () => {
    const { response } = await get("?date=2026-05-21", false);

    expect(response.status).toBe(401);
    expect(board.listDraftsForBoard).not.toHaveBeenCalled();
  });

  it("needs a YYYY-MM-DD date", async () => {
    const { response, json } = await get("?date=May-21");

    expect(response.status).toBe(400);
    expect(json.error).toContain("date");
  });

  it("lists the date's drafts and the version the next commit makes", async () => {
    const { response, json } = await get("?date=2026-05-21");

    expect(response.status).toBe(200);
    expect(board.listDraftsForBoard).toHaveBeenCalledWith("2026-05-21");
    expect(json).toEqual({ owner: "native", drafts: [ENTRY, { ...ENTRY, id: 40, version: 1 }], nextVersion: 3 });
  });

  it("reads no drafts while n8n drafts, so the board works as before", async () => {
    outlineStore.readDraftOwner.mockResolvedValue("n8n");

    const { json } = await get("?date=2026-05-21");

    expect(json).toEqual({ owner: "n8n", drafts: [], nextVersion: 1 });
    expect(board.listDraftsForBoard).not.toHaveBeenCalled();
  });
});
