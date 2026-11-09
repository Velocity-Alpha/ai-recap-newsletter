import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitStore } from "@/src/server/rate-limit-store";

const limits = vi.hoisted(() => ({ store: null as RateLimitStore | null }));

vi.mock("@/src/server/rate-limit-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/rate-limit-store")>();
  return { ...actual, getRateLimitStore: () => limits.store };
});

import { POST } from "@/app/api/approval/login/route";
import { APPROVAL_SESSION_COOKIE_NAME, hasValidApprovalSession } from "@/src/server/approval-auth";
import { createMemoryRateLimitStore } from "@/src/server/rate-limit-store";

const PASSWORD = "approval-secret";

function login(body: unknown, ip = "203.0.113.7") {
  return POST(
    new NextRequest("http://localhost/api/approval/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nf-client-connection-ip": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function sessionCookie(response: Response) {
  return (response as unknown as { cookies: { get(name: string): { value: string } | undefined } }).cookies.get(
    APPROVAL_SESSION_COOKIE_NAME,
  );
}

describe("POST /api/approval/login", () => {
  beforeEach(() => {
    limits.store = createMemoryRateLimitStore();
    vi.stubEnv("APPROVAL_PASSWORD", PASSWORD);
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs the owner in with the right password", async () => {
    const response = await login({ password: PASSWORD });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${APPROVAL_SESSION_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=strict/i);
    expect(setCookie).toMatch(/Max-Age=86400/);

    const token = sessionCookie(response)?.value;
    const nextRequest = new Request("http://localhost/api/approval/outline", {
      headers: { cookie: `${APPROVAL_SESSION_COOKIE_NAME}=${token}` },
    });
    await expect(hasValidApprovalSession(nextRequest)).resolves.toBe(true);
  });

  it("rejects a wrong password without setting a cookie", async () => {
    for (const password of ["wrong", "approval-secreT", `${PASSWORD}x`, ""]) {
      const response = await login({ password }, `198.51.100.${password.length}`);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Password incorrect." });
      expect(sessionCookie(response)).toBeUndefined();
    }
  });

  it("rejects a missing, non-string, or unreadable password", async () => {
    for (const body of [{}, { password: 123 }, { password: [PASSWORD] }, "not json"]) {
      const response = await login(body);
      expect(response.status).toBe(401);
    }
  });

  it("locks an IP out after five wrong passwords, even for the right one", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await login({ password: "wrong" })).status).toBe(401);
    }

    const locked = await login({ password: PASSWORD });

    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await locked.json()).error).toMatch(/Too many attempts/);
    expect(sessionCookie(locked)).toBeUndefined();
  });

  it("keeps other IPs working while one is locked out", async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await login({ password: "wrong" }, "203.0.113.7");
    }

    expect((await login({ password: PASSWORD }, "198.51.100.20")).status).toBe(200);
  });

  it("clears the count after a successful login", async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await login({ password: "wrong" });
    }
    expect((await login({ password: PASSWORD })).status).toBe(200);

    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await login({ password: "wrong" })).status).toBe(401);
    }
    expect((await login({ password: PASSWORD })).status).toBe(200);
  });

  it("refuses every login when the password is not set", async () => {
    vi.stubEnv("APPROVAL_PASSWORD", "");

    const response = await login({ password: "" });

    expect(response.status).toBe(503);
    expect(sessionCookie(response)).toBeUndefined();
  });

  it("refuses every login when SESSION_SECRET is not set", async () => {
    vi.stubEnv("SESSION_SECRET", "");

    const response = await login({ password: PASSWORD });

    expect(response.status).toBe(503);
    expect(sessionCookie(response)).toBeUndefined();
  });
});
