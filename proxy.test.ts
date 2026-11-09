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
    expect(config.matcher).toEqual(expect.arrayContaining(["/admin/:path*", "/api/admin/:path*"]));
  });

  it("sends a visitor without a session from an admin page to the login page", async () => {
    const response = await visit("/admin/runs?before=40");

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/approval/login");
    expect(location.searchParams.get("redirect")).toBe("/admin/runs?before=40");
  });

  it("answers 401 for an admin API call without a session, instead of a redirect", async () => {
    const response = await visit("/api/admin/stage-switches", "a".repeat(64));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
  });

  it("lets a signed-in owner reach the admin pages and API", async () => {
    const token = await createApprovalSessionToken();

    expect(isPassedThrough(await visit("/admin", token))).toBe(true);
    expect(isPassedThrough(await visit("/api/admin/stage-switches", token))).toBe(true);
  });
});
