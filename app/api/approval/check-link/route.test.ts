import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const paywall = vi.hoisted(() => ({ checkPaywall: vi.fn() }));
vi.mock("@/src/pipeline/ingest/paywall", () => paywall);

const sites = vi.hoisted(() => ({ learnedSites: vi.fn() }));
vi.mock("@/src/pipeline/free-links/paywall-sites", () => sites);

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
    sites.learnedSites.mockResolvedValue(["learned.example"]);
    paywall.checkPaywall.mockResolvedValue({ status: "no", error: "" });
  });

  it("answers 401 without the approval session, and checks nothing", async () => {
    const response = await POST(makeRequest({ url: "https://news.example/a" }));

    expect(response.status).toBe(401);
    expect(paywall.checkPaywall).not.toHaveBeenCalled();
    expect(sites.learnedSites).not.toHaveBeenCalled();
  });

  it("answers the paywall check's state for the link, and gives the check the learned sites", async () => {
    paywall.checkPaywall.mockResolvedValue({ status: "yes", error: "" });
    const token = await createApprovalSessionToken();

    const response = await POST(makeRequest({ url: " https://news.example/a " }, token));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paywall: "yes" });
    expect(paywall.checkPaywall).toHaveBeenCalledWith("https://news.example/a", { learnedSites: ["learned.example"] });
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
    sites.learnedSites.mockRejectedValue(new Error("database is down"));
    const token = await createApprovalSessionToken();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(makeRequest({ url: "https://news.example/a" }, token));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paywall: "error" });
    logged.mockRestore();
  });
});
