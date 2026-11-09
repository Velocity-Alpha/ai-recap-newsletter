import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "@/proxy";
import { APPROVAL_SESSION_COOKIE_NAME, createApprovalSessionToken } from "@/src/server/approval-auth";

function visit(path: string, token?: string) {
  return proxy(
    new NextRequest(`http://localhost${path}`, {
      headers: token ? { cookie: `${APPROVAL_SESSION_COOKIE_NAME}=${token}` } : {},
    }),
  );
}

function send(path: string, { method = "POST", token, headers = {} }: SendOptions = {}) {
  return proxy(
    new NextRequest(`https://airecap.news${path}`, {
      method,
      headers: { ...(token ? { cookie: `${APPROVAL_SESSION_COOKIE_NAME}=${token}` } : {}), ...headers },
    }),
  );
}

type SendOptions = { method?: string; token?: string; headers?: Record<string, string> };

const SAME_ORIGIN_JSON = { origin: "https://airecap.news", "content-type": "application/json" };

function isPassedThrough(response: Response) {
  return response.headers.get("x-middleware-next") === "1";
}

describe("approval proxy", () => {
  beforeEach(() => {
    vi.stubEnv("APPROVAL_PASSWORD", "approval-secret");
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("always lets the login page through", async () => {
    vi.stubEnv("APPROVAL_PASSWORD", "");

    expect(isPassedThrough(await visit("/approval/login"))).toBe(true);
  });

  it("lets a signed-in owner reach the board", async () => {
    const token = await createApprovalSessionToken();

    expect(isPassedThrough(await visit("/approval?date=2026-11-09", token))).toBe(true);
  });

  it("sends a visitor without a session to the login page, keeping the destination", async () => {
    const response = await visit("/approval/issues?date=2026-11-09");

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/approval/login");
    expect(location.searchParams.get("redirect")).toBe("/approval/issues?date=2026-11-09");
  });

  it("rejects the old static cookie value", async () => {
    const response = await visit("/approval", "a".repeat(64));

    expect(response.status).toBe(307);
  });

  it("fails closed when the password is not set", async () => {
    const token = await createApprovalSessionToken();
    vi.stubEnv("APPROVAL_PASSWORD", "");

    expect((await visit("/approval")).status).toBe(307);
    expect((await visit("/approval", token)).status).toBe(307);
  });

  describe("state-changing requests", () => {
    it.each([
      ["/api/newsletters/commit", "https://example.com"],
      ["/api/newsletters/commit", "https://sites.airecap.news"],
      ["/api/approval/issues/3/publish", "https://sites.airecap.news"],
      ["/api/admin/subscribers", "https://sites.airecap.news"],
      ["/approval", "https://sites.airecap.news"],
    ])("refuses a POST to %s from %s, even with a valid session", async (path, origin) => {
      const token = await createApprovalSessionToken();

      const response = await send(path, { token, headers: { origin, "content-type": "application/json" } });

      expect(response.status).toBe(403);
    });

    it("refuses a POST without Origin when Sec-Fetch-Site is same-site", async () => {
      const token = await createApprovalSessionToken();
      const headers = { "sec-fetch-site": "same-site", "content-type": "application/json" };

      expect((await send("/api/newsletters/commit", { token, headers })).status).toBe(403);
    });

    it("lets the board's own JSON POSTs through to the route's session check", async () => {
      const token = await createApprovalSessionToken();

      expect(isPassedThrough(await send("/api/newsletters/commit", { token, headers: SAME_ORIGIN_JSON }))).toBe(true);
      expect(isPassedThrough(await send("/api/approval/issues/3/publish", { headers: SAME_ORIGIN_JSON }))).toBe(true);
      expect(isPassedThrough(await send("/api/approval/login", { headers: SAME_ORIGIN_JSON }))).toBe(true);
    });

    it("refuses an API write that is not JSON with 415", async () => {
      const token = await createApprovalSessionToken();
      const headers = { origin: "https://airecap.news", "content-type": "text/plain;charset=UTF-8" };

      expect((await send("/api/newsletters/commit", { token, headers })).status).toBe(415);
      expect((await send("/api/approval/issues/3/publish", { token, headers: { origin: headers.origin } })).status).toBe(
        415,
      );
    });

    it("leaves API reads to the route, without redirecting to login", async () => {
      const response = await send("/api/approval/outline?date=2026-11-09", {
        method: "GET",
        headers: { origin: "https://sites.airecap.news" },
      });

      expect(isPassedThrough(response)).toBe(true);
    });
  });

  it("runs for the approval pages and every approval and admin API", async () => {
    // Next's matcher helper reads AsyncLocalStorage from the global scope, as the Next server provides it.
    const { AsyncLocalStorage } = await import("node:async_hooks");
    Object.assign(globalThis, { AsyncLocalStorage });
    const { unstable_doesMiddlewareMatch: matches } = await import("next/experimental/testing/server");

    for (const url of [
      "/approval",
      "/approval/issues",
      "/approval/login",
      "/api/approval/login",
      "/api/approval/outline",
      "/api/approval/issues/3/publish",
      "/api/newsletters/commit",
      "/api/admin",
      "/api/admin/subscribers/7",
    ]) {
      expect(matches({ config, url }), url).toBe(true);
    }
    for (const url of ["/", "/api/newsletters", "/api/subscriber/subscribe", "/api/administrator"]) {
      expect(matches({ config, url }), url).toBe(false);
    }
  });
});

describe("admin proxy", () => {
  beforeEach(() => {
    vi.stubEnv("APPROVAL_PASSWORD", "approval-secret");
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs on every admin page and admin API path", () => {
    expect(config.matcher).toEqual(expect.arrayContaining(["/admin", "/admin/:path*", "/api/admin", "/api/admin/:path*"]));
  });

  it("sends a visitor without a session from an admin page to the login page", async () => {
    const response = await visit("/admin/runs?before=40");

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/approval/login");
    expect(location.searchParams.get("redirect")).toBe("/admin/runs?before=40");
  });

  it("refuses a cross-site admin API write, and leaves the session check to the route (withAdminApi)", async () => {
    const crossSite = await send("/api/admin/stage-switches", {
      headers: { origin: "https://evil.example", "content-type": "application/json" },
    });
    const noSession = await send("/api/admin/stage-switches", { headers: SAME_ORIGIN_JSON });

    expect(crossSite.status).toBe(403);
    expect(isPassedThrough(noSession)).toBe(true);
  });

  it("lets a signed-in owner reach the admin pages and API", async () => {
    const token = await createApprovalSessionToken();

    expect(isPassedThrough(await visit("/admin", token))).toBe(true);
    expect(isPassedThrough(await visit("/api/admin/stage-switches", token))).toBe(true);
  });
});
