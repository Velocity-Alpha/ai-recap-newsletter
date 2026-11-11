import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const paywallSites = vi.hoisted(() => ({ ignorePaywallSite: vi.fn() }));
vi.mock("@/src/features/admin/paywall-sites", () => paywallSites);

import { POST } from "@/app/api/admin/paywall-sites/ignore/route";

async function post(body: unknown, signedIn = true) {
  const token = signedIn ? await createApprovalSessionToken() : undefined;
  return POST(
    new Request("http://localhost/api/admin/paywall-sites/ignore", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { Cookie: `approval_session=${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    {},
  );
}

describe("POST /api/admin/paywall-sites/ignore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.SESSION_SECRET = "test-session-secret";
    paywallSites.ignorePaywallSite.mockResolvedValue(true);
  });

  it("answers 401 without a session, and changes nothing", async () => {
    const response = await post({ site: "learned.example" }, false);

    expect(response.status).toBe(401);
    expect(paywallSites.ignorePaywallSite).not.toHaveBeenCalled();
  });

  it("ignores the site", async () => {
    const response = await post({ site: "learned.example" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ site: "learned.example", ignored: true });
    expect(paywallSites.ignorePaywallSite).toHaveBeenCalledWith("learned.example");
  });

  it("answers 400 without a site name, and changes nothing", async () => {
    for (const body of [{}, { site: "" }, { site: 7 }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(paywallSites.ignorePaywallSite).not.toHaveBeenCalled();
  });

  it("answers 404 for a site that has no row", async () => {
    paywallSites.ignorePaywallSite.mockResolvedValue(false);

    expect((await post({ site: "missing.example" })).status).toBe(404);
  });
});
