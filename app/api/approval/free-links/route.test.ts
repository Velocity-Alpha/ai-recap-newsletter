import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const job = vi.hoisted(() => ({ storiesToSearch: vi.fn(), startFreeLinksJob: vi.fn(), readFreeLinks: vi.fn() }));
vi.mock("@/src/pipeline/free-links/find-free-links", () => ({ prismaFreeLinksStore: { storiesToSearch: job.storiesToSearch } }));
vi.mock("@/src/pipeline/free-links/read-free-links", () => ({ readFreeLinks: job.readFreeLinks }));
vi.mock("@/src/pipeline/free-links/start-free-links", async (original) => ({
  ...(await original<typeof import("@/src/pipeline/free-links/start-free-links")>()),
  startFreeLinksJob: job.startFreeLinksJob,
}));

import { GET, POST } from "@/app/api/approval/free-links/route";

const URL_ = "http://localhost/api/approval/free-links";

function cookie(token?: string): Record<string, string> {
  return token ? { Cookie: `approval_session=${token}` } : {};
}

function post(body: unknown, token?: string) {
  return new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...cookie(token) }, body: JSON.stringify(body) });
}

function get(ids: string | null, token?: string) {
  return new Request(ids === null ? URL_ : `${URL_}?ids=${ids}`, { headers: cookie(token) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APPROVAL_PASSWORD = "approval-secret";
  process.env.SESSION_SECRET = "test-session-secret";
  job.storiesToSearch.mockResolvedValue([{ id: 2 }, { id: 3 }]);
  job.startFreeLinksJob.mockResolvedValue({ status: "started" });
  job.readFreeLinks.mockResolvedValue({ 2: { done: true, links: [] } });
});

describe("POST /api/approval/free-links", () => {
  it("answers 401 without the approval session, and starts nothing", async () => {
    const response = await POST(post({ story_ids: [1] }));

    expect(response.status).toBe(401);
    expect(job.storiesToSearch).not.toHaveBeenCalled();
    expect(job.startFreeLinksJob).not.toHaveBeenCalled();
  });

  it("starts the background function for the stories that were not searched before", async () => {
    const response = await POST(post({ story_ids: [1, 2, 3] }, await createApprovalSessionToken()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ started: 2 });
    expect(job.storiesToSearch).toHaveBeenCalledWith([1, 2, 3]);
    expect(job.startFreeLinksJob).toHaveBeenCalledWith([2, 3], { siteUrl: "http://localhost" });
  });

  it("starts nothing when every story was searched before", async () => {
    job.storiesToSearch.mockResolvedValue([]);

    const response = await POST(post({ story_ids: [1, 2] }, await createApprovalSessionToken()));

    expect(await response.json()).toEqual({ started: 0 });
    expect(job.startFreeLinksJob).not.toHaveBeenCalled();
  });

  it.each([
    ["no ids", {}],
    ["an empty list", { story_ids: [] }],
    ["an id that is not a number", { story_ids: ["1"] }],
    ["more than 60 ids", { story_ids: Array.from({ length: 61 }, (_, index) => index + 1) }],
  ])("answers 400 for %s", async (_name, body) => {
    const response = await POST(post(body, await createApprovalSessionToken()));

    expect(response.status).toBe(400);
    expect(job.startFreeLinksJob).not.toHaveBeenCalled();
  });

  it("answers 502 when the background function did not start", async () => {
    job.startFreeLinksJob.mockRejectedValue(new Error("Starting the free links job failed with HTTP 500."));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(post({ story_ids: [2] }, await createApprovalSessionToken()));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The search for free links did not start." });
    logged.mockRestore();
  });
});

describe("GET /api/approval/free-links", () => {
  it("answers 401 without the approval session, and reads nothing", async () => {
    const response = await GET(get("1,2"));

    expect(response.status).toBe(401);
    expect(job.readFreeLinks).not.toHaveBeenCalled();
  });

  it("answers the free links of the stories, by story id", async () => {
    const response = await GET(get("2,5", await createApprovalSessionToken()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stories: { 2: { done: true, links: [] } } });
    expect(job.readFreeLinks).toHaveBeenCalledWith([2, 5]);
  });

  it.each([
    ["no ids", null],
    ["an id that is not a number", "1,x"],
    ["an empty id", "1,,2"],
    ["more than 60 ids", Array.from({ length: 61 }, (_, index) => index + 1).join(",")],
  ])("answers 400 for %s", async (_name, ids) => {
    const response = await GET(get(ids, await createApprovalSessionToken()));

    expect(response.status).toBe(400);
    expect(job.readFreeLinks).not.toHaveBeenCalled();
  });
});
