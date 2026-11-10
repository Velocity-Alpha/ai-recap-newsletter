import { beforeEach, describe, expect, it, vi } from "vitest";

import { DraftEditError, IssuePublishedError, titleTakenMessage } from "@/src/pipeline/draft/draft-store";
import { createApprovalSessionToken } from "@/src/server/approval-auth";

const board = vi.hoisted(() => ({ readDraftForBoard: vi.fn() }));
vi.mock("@/src/pipeline/draft/draft-board", () => board);

const draftEdit = vi.hoisted(() => ({ changeDraftTitle: vi.fn() }));
vi.mock("@/src/pipeline/draft/draft-edit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/draft-edit")>()),
  ...draftEdit,
}));

import { GET, PATCH } from "@/app/api/approval/drafts/[id]/route";
import { DraftTitleError } from "@/src/pipeline/draft/draft-edit";

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

async function changeTitle(id: string, body: unknown, signedIn = true) {
  const token = await createApprovalSessionToken();
  const response = await PATCH(
    new Request(`http://localhost/api/approval/drafts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(signedIn ? { Cookie: `approval_session=${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
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

  it("changes nothing", async () => {
    board.readDraftForBoard.mockResolvedValue({ id: 41, status: "ready" });

    await get("41");

    expect(draftEdit.changeDraftTitle).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/approval/drafts/[id] (change the title)", () => {
  const CHANGED = {
    draftId: 41,
    issueId: 3,
    version: 2,
    issueDate: "2026-05-21",
    content: { title: "A Sample Robot Learns To Fold" },
    featuredImageUrl: "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-05-21-abc123.jpg",
    scenePrompt: "A lamp.",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    draftEdit.changeDraftTitle.mockResolvedValue(CHANGED);
  });

  it("needs the approval login, and changes nothing without it", async () => {
    const { response, json } = await changeTitle("41", { title: "A new title" }, false);

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized." });
    expect(draftEdit.changeDraftTitle).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1", "1.5"])("rejects the id %s", async (id) => {
    const { response, json } = await changeTitle(id, { title: "A new title" });

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "Invalid draft id." });
    expect(draftEdit.changeDraftTitle).not.toHaveBeenCalled();
  });

  it("changes the draft's title and answers with the title as it was saved", async () => {
    const { response, json } = await changeTitle("41", { title: "  A Sample Robot   Learns To Fold " });

    expect(response.status).toBe(200);
    expect(draftEdit.changeDraftTitle).toHaveBeenCalledTimes(1);
    expect(draftEdit.changeDraftTitle).toHaveBeenCalledWith(41, { title: "  A Sample Robot   Learns To Fold " });
    expect(json).toEqual({ success: true, title: "A Sample Robot Learns To Fold" });
  });

  it("passes a body that is not JSON on as nothing, for the check to refuse", async () => {
    draftEdit.changeDraftTitle.mockRejectedValue(new DraftTitleError("Send the new title."));

    const { response, json } = await changeTitle("41", "not json");

    expect(draftEdit.changeDraftTitle).toHaveBeenCalledWith(41, null);
    expect(response.status).toBe(400);
    expect(json).toEqual({ success: false, error: "Send the new title." });
  });

  it.each([
    [400, new DraftTitleError("The title is empty. Write a title first.")],
    [400, new DraftTitleError("The title is 201 characters. Keep it to 200 or fewer.")],
    [404, new DraftEditError("Draft 41 does not exist.", "missing")],
    [409, new DraftEditError("Draft v1 for 2026-05-21 is running. Only a ready draft can be changed.", "not_ready")],
    [409, new DraftEditError("Draft v1 is not the newest draft for 2026-05-21: v2 is running. Reload the page.", "not_current")],
    [409, new DraftEditError(titleTakenMessage("A Sample Robot Learns To Fold", "Use a different title."), "title_taken")],
    [409, new IssuePublishedError(3, "2026-05-21")],
  ])("answers %i with the plain reason", async (status, error) => {
    draftEdit.changeDraftTitle.mockRejectedValue(error);

    const { response, json } = await changeTitle("41", { title: "A Sample Robot Learns To Fold" });

    expect(response.status).toBe(status);
    expect(json).toEqual({ success: false, error: error.message });
  });

  it("answers 500 without details for anything else", async () => {
    draftEdit.changeDraftTitle.mockRejectedValue(new Error("connection string leaked here"));

    const { response, json } = await changeTitle("41", { title: "A new title" });

    expect(response.status).toBe(500);
    expect(json).toEqual({ success: false, error: "Could not change the title." });
  });
});
