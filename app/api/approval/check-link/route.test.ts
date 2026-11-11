import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const paywall = vi.hoisted(() => ({ checkPaywall: vi.fn(), guardedFetch: vi.fn(), OWNER_CHECK_TIMEOUT_MS: 5_000 }));
vi.mock("@/src/pipeline/ingest/paywall", () => paywall);

const sites = vi.hoisted(() => ({ learnedSitesOrNone: vi.fn() }));
vi.mock("@/src/pipeline/free-links/paywall-sites", () => sites);

const GUARDED_FETCH = async () => new Response("");

import { POST } from "@/app/api/approval/check-link/route";

function makeRequest(body: unknown, token?: string) {
  return new Request("http://localhost/api/approval/check-link", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Cookie: `approval_session=${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/approval/check-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    sites.learnedSitesOrNone.mockResolvedValue(["learned.example"]);
    paywall.guardedFetch.mockReturnValue(GUARDED_FETCH);
    paywall.checkPaywall.mockResolvedValue({ status: "no", error: "" });
  });

  it("answers 401 without the approval session, and checks nothing", async () => {
    const response = await POST(makeRequest({ url: "https://news.example/a" }));

    expect(response.status).toBe(401);
    expect(paywall.checkPaywall).not.toHaveBeenCalled();
    expect(sites.learnedSitesOrNone).not.toHaveBeenCalled();
  });

  it("answers the paywall check's state for the link", async () => {
    paywall.checkPaywall.mockResolvedValue({ status: "yes", error: "" });
    const token = await createApprovalSessionToken();

    const response = await POST(makeRequest({ url: " https://news.example/a " }, token));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paywall: "yes" });
  });

  it("gives the check the trimmed link, the learned sites, the guarded fetch and the 5 second limit", async () => {
    const token = await createApprovalSessionToken();

    await POST(makeRequest({ url: " https://news.example/a " }, token));

    expect(paywall.checkPaywall).toHaveBeenCalledWith("https://news.example/a", {
      fetch: GUARDED_FETCH,
      learnedSites: ["learned.example"],
      timeoutMs: 5_000,
    });
  });

  it.each([
    ["no link", {}],
    ["a link that is not text", { url: 7 }],
    ["text that is not a link", { url: "not a link" }],
    ["a link that is not http or https", { url: "file:///etc/hosts" }],
    ["a body that is not JSON", "{"],
  ])("answers 400 for %s, and checks nothing", async (_name, body) => {
    const token = await createApprovalSessionToken();

    const response = await POST(makeRequest(body, token));

    expect(response.status).toBe(400);
    expect(paywall.checkPaywall).not.toHaveBeenCalled();
  });

  it("answers error when the check cannot run", async () => {
    paywall.checkPaywall.mockRejectedValue(new Error("the check broke"));
    const token = await createApprovalSessionToken();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(makeRequest({ url: "https://news.example/a" }, token));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paywall: "error" });
    logged.mockRestore();
  });
});
