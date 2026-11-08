import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const fns = vi.hoisted(() => ({
  previewManualPublish: vi.fn(),
  manualPublish: vi.fn(),
}));

vi.mock("@/src/pipeline/publish/manual-publish", () => fns);

const cache = vi.hoisted(() => ({ refreshPublishedIssues: vi.fn() }));
vi.mock("@/src/features/newsletter/cache", () => cache);

import { GET, POST } from "@/app/api/approval/issues/[id]/publish/route";

const PREVIEW = { issueId: 260, status: "ready", title: "T", date: "2026-10-22", storyCount: 12, problems: [] };

async function request(method: "GET" | "POST", withSession = true) {
  const headers = withSession
    ? { cookie: `approval_session=${await createApprovalSessionToken("approval-secret")}` }
    : undefined;
  return new Request("http://localhost/api/approval/issues/260/publish", { method, headers });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/approval/issues/[id]/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
  });

  it("rejects requests without an approval session", async () => {
    const get = await GET(await request("GET", false), params("260"));
    const post = await POST(await request("POST", false), params("260"));

    expect([get.status, post.status]).toEqual([401, 401]);
    expect(fns.previewManualPublish).not.toHaveBeenCalled();
    expect(fns.manualPublish).not.toHaveBeenCalled();
  });

  it("rejects an invalid issue id", async () => {
    const response = await POST(await request("POST"), params("abc"));

    expect(response.status).toBe(400);
    expect(fns.manualPublish).not.toHaveBeenCalled();
  });

  it("previews what the button would publish", async () => {
    fns.previewManualPublish.mockResolvedValueOnce(PREVIEW);

    const response = await GET(await request("GET"), params("260"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preview: PREVIEW });
    expect(fns.previewManualPublish).toHaveBeenCalledWith(260);
  });

  it("publishes the issue now", async () => {
    fns.manualPublish.mockResolvedValueOnce({ outcome: "published", preview: PREVIEW });

    const response = await POST(await request("POST"), params("260"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "published", preview: PREVIEW });
    expect(fns.manualPublish).toHaveBeenCalledWith(260, expect.any(Date));
    expect(cache.refreshPublishedIssues).toHaveBeenCalledTimes(1);
  });

  it("still reports the publish when the site refresh fails; the lists catch up within the hour", async () => {
    fns.manualPublish.mockResolvedValueOnce({ outcome: "published", preview: PREVIEW });
    cache.refreshPublishedIssues.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });

    const response = await POST(await request("POST"), params("260"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "published", preview: PREVIEW });
  });

  it("answers with a conflict when the issue is already published, and 404 when it does not exist", async () => {
    fns.manualPublish
      .mockResolvedValueOnce({ outcome: "already_published", preview: { ...PREVIEW, status: "already_published" } })
      .mockResolvedValueOnce({ outcome: "not_found", preview: { ...PREVIEW, status: "not_found" } });

    expect((await POST(await request("POST"), params("260"))).status).toBe(409);
    expect((await POST(await request("POST"), params("260"))).status).toBe(404);
    expect(cache.refreshPublishedIssues).not.toHaveBeenCalled();
  });

  it("returns a 500 without details when publishing throws", async () => {
    fns.manualPublish.mockRejectedValueOnce(new Error("connection refused"));

    const response = await POST(await request("POST"), params("260"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not publish the issue." });
  });
});
