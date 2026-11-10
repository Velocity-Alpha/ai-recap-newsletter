import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "approval_session" && cookieJar.token !== undefined ? { name, value: cookieJar.token } : undefined,
  }),
}));

import {
  ADMIN_ACTOR,
  adminSessionFromRequest,
  getAdminSession,
  requireAdminPage,
  withAdminApi,
} from "@/src/server/admin-auth";
import { APPROVAL_SESSION_COOKIE_NAME, createApprovalSessionToken } from "@/src/server/approval-auth";

function request(token?: string) {
  return new Request("http://localhost/api/admin/example", {
    method: "POST",
    headers: token ? { cookie: `${APPROVAL_SESSION_COOKIE_NAME}=${token}` } : {},
  });
}

async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  const error = (await promise.then(
    () => null,
    (caught: unknown) => caught,
  )) as { digest?: string } | null;
  // next/navigation's redirect() throws an error whose digest is "NEXT_REDIRECT;<type>;<url>;<status>;".
  expect(error?.digest).toMatch(/^NEXT_REDIRECT;/);
  return error!.digest!.split(";")[2];
}

describe("admin guard", () => {
  beforeEach(() => {
    vi.stubEnv("APPROVAL_PASSWORD", "approval-secret");
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
    cookieJar.token = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getAdminSession (pages)", () => {
    it("names the approval login as the actor for a valid session", async () => {
      cookieJar.token = await createApprovalSessionToken();

      await expect(getAdminSession()).resolves.toEqual({ actor: ADMIN_ACTOR });
      expect(ADMIN_ACTOR).toBe("approval login");
    });

    it("refuses a missing, forged, or expired cookie", async () => {
      await expect(getAdminSession()).resolves.toBeNull();

      cookieJar.token = `${Date.now() + 60_000}.${"a".repeat(32)}.${"b".repeat(64)}`;
      await expect(getAdminSession()).resolves.toBeNull();

      cookieJar.token = await createApprovalSessionToken(undefined, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
      await expect(getAdminSession()).resolves.toBeNull();
    });

    it("fails closed when the approval login is not configured", async () => {
      cookieJar.token = await createApprovalSessionToken();
      vi.stubEnv("SESSION_SECRET", "");

      await expect(getAdminSession()).resolves.toBeNull();
    });
  });

  describe("requireAdminPage", () => {
    it("sends a visitor without a session to the login page, keeping the destination", async () => {
      const target = await redirectTarget(requireAdminPage("/admin/runs/12"));

      const url = new URL(target, "http://localhost");
      expect(url.pathname).toBe("/approval/login");
      expect(url.searchParams.get("redirect")).toBe("/admin/runs/12");
    });

    it("returns the session when it is valid", async () => {
      cookieJar.token = await createApprovalSessionToken();

      await expect(requireAdminPage("/admin")).resolves.toEqual({ actor: ADMIN_ACTOR });
    });
  });

  describe("API routes", () => {
    it("reads the session from the request cookie", async () => {
      await expect(adminSessionFromRequest(request(await createApprovalSessionToken()))).resolves.toEqual({
        actor: ADMIN_ACTOR,
      });
      await expect(adminSessionFromRequest(request())).resolves.toBeNull();
    });

    it("answers 401 without calling the handler when there is no valid session", async () => {
      const handler = vi.fn(async () => new Response("ok"));
      const route = withAdminApi(handler);

      const response = await route(request("not-a-token"), {});

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized." });
      expect(handler).not.toHaveBeenCalled();
    });

    it("passes the session and the route context to the handler", async () => {
      const handler = vi.fn(async () => new Response("ok"));
      const route = withAdminApi(handler);
      const signedIn = request(await createApprovalSessionToken());
      const context = { params: Promise.resolve({ id: "1" }) };

      const response = await route(signedIn, context);

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(signedIn, { actor: ADMIN_ACTOR }, context);
    });
  });
});
