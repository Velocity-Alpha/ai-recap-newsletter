import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const draftStore = vi.hoisted(() => ({ getDraftHtml: vi.fn() }));
vi.mock("@/src/pipeline/draft/draft-store", () => draftStore);

import { GET } from "@/app/api/approval/drafts/[id]/html/route";

async function get(id: string, signedIn = true) {
  const token = await createApprovalSessionToken("approval-secret");
  return GET(
    new Request(`http://localhost/api/approval/drafts/${id}/html`, {
      headers: signedIn ? { Cookie: `approval_session=${token}` } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("GET /api/approval/drafts/[id]/html", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
  });

  it("needs the approval login", async () => {
    const response = await get("41", false);

    expect(response.status).toBe(401);
    expect(draftStore.getDraftHtml).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a number", async () => {
    expect((await get("-1")).status).toBe(400);
    expect(draftStore.getDraftHtml).not.toHaveBeenCalled();
  });

  it("answers 404 when the draft has no email yet", async () => {
    draftStore.getDraftHtml.mockResolvedValue(null);

    expect((await get("41")).status).toBe(404);
  });

  it("serves the email HTML for the preview frame, sandboxed and never cached", async () => {
    draftStore.getDraftHtml.mockResolvedValue("<html><body>Hello</body></html>");

    const response = await get("41");

    expect(response.status).toBe(200);
    expect(draftStore.getDraftHtml).toHaveBeenCalledWith(41);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(await response.text()).toBe("<html><body>Hello</body></html>");
  });
});
