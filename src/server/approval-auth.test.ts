import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPROVAL_SESSION_COOKIE_NAME,
  APPROVAL_SESSION_TTL_SECONDS,
  createApprovalSessionToken,
  getApprovalAuthConfig,
  hasValidApprovalSession,
  isValidApprovalSessionToken,
} from "@/src/server/approval-auth";

const config = { password: "approval-secret", sessionSecret: "test-session-secret" };
const NOW = new Date("2026-11-09T12:00:00Z");

function requestWithCookie(token?: string) {
  return new Request("http://localhost/api/approval/outline", {
    headers: token ? { cookie: `other=1; ${APPROVAL_SESSION_COOKIE_NAME}=${token}` } : {},
  });
}

describe("getApprovalAuthConfig", () => {
  it("needs both the password and SESSION_SECRET", () => {
    expect(getApprovalAuthConfig({ APPROVAL_PASSWORD: "p", SESSION_SECRET: "s" })).toEqual({
      password: "p",
      sessionSecret: "s",
    });
    expect(getApprovalAuthConfig({ SESSION_SECRET: "s" })).toBeNull();
    expect(getApprovalAuthConfig({ APPROVAL_PASSWORD: "", SESSION_SECRET: "s" })).toBeNull();
    expect(getApprovalAuthConfig({ APPROVAL_PASSWORD: "p" })).toBeNull();
    expect(getApprovalAuthConfig({ APPROVAL_PASSWORD: "p", SESSION_SECRET: "  " })).toBeNull();
  });
});

describe("approval session tokens", () => {
  it("accepts a fresh token", async () => {
    const token = await createApprovalSessionToken(config, NOW);

    await expect(isValidApprovalSessionToken(token, config, NOW)).resolves.toBe(true);
  });

  it("gives each login its own token, unrelated to the password", async () => {
    const first = await createApprovalSessionToken(config, NOW);
    const second = await createApprovalSessionToken(config, NOW);
    const oldStaticToken = createHash("sha256").update(`approval:${config.password}`).digest("hex");

    expect(first).not.toBe(second);
    expect(first).not.toContain(config.password);
    expect(first).not.toContain(oldStaticToken);
  });

  it("rejects the old static cookie value", async () => {
    const oldStaticToken = createHash("sha256").update(`approval:${config.password}`).digest("hex");

    await expect(isValidApprovalSessionToken(oldStaticToken, config, NOW)).resolves.toBe(false);
  });

  it("expires on the server after the session lifetime", async () => {
    const token = await createApprovalSessionToken(config, NOW);
    const justBefore = new Date(NOW.getTime() + APPROVAL_SESSION_TTL_SECONDS * 1000 - 1000);
    const atExpiry = new Date(NOW.getTime() + APPROVAL_SESSION_TTL_SECONDS * 1000);

    await expect(isValidApprovalSessionToken(token, config, justBefore)).resolves.toBe(true);
    await expect(isValidApprovalSessionToken(token, config, atExpiry)).resolves.toBe(false);
  });

  it("rejects a token whose expiry was edited", async () => {
    const token = await createApprovalSessionToken(config, NOW);
    const [, nonce, signature] = token.split(".");
    const later = String(NOW.getTime() + 10 * APPROVAL_SESSION_TTL_SECONDS * 1000);

    await expect(isValidApprovalSessionToken(`${later}.${nonce}.${signature}`, config, NOW)).resolves.toBe(false);
  });

  it("rejects a token with a changed signature", async () => {
    const token = await createApprovalSessionToken(config, NOW);
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");

    await expect(isValidApprovalSessionToken(flipped, config, NOW)).resolves.toBe(false);
  });

  it("ends every session when the password or SESSION_SECRET changes", async () => {
    const token = await createApprovalSessionToken(config, NOW);

    await expect(
      isValidApprovalSessionToken(token, { ...config, password: "new-password" }, NOW),
    ).resolves.toBe(false);
    await expect(
      isValidApprovalSessionToken(token, { ...config, sessionSecret: "new-secret" }, NOW),
    ).resolves.toBe(false);
  });

  it("rejects missing and malformed tokens", async () => {
    for (const token of [undefined, null, "", "abc", "1.2", "x.y.z", `${NOW.getTime() + 1000}.zz.zz`, "1.2.3.4"]) {
      await expect(isValidApprovalSessionToken(token, config, NOW)).resolves.toBe(false);
    }
  });
});

describe("hasValidApprovalSession", () => {
  beforeEach(() => {
    vi.stubEnv("APPROVAL_PASSWORD", config.password);
    vi.stubEnv("SESSION_SECRET", config.sessionSecret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a request carrying a valid session cookie", async () => {
    const token = await createApprovalSessionToken();

    await expect(hasValidApprovalSession(requestWithCookie(token))).resolves.toBe(true);
  });

  it("rejects a request without the cookie", async () => {
    await expect(hasValidApprovalSession(requestWithCookie())).resolves.toBe(false);
  });

  it("fails closed when the password is not set, in every environment", async () => {
    const token = await createApprovalSessionToken();
    vi.stubEnv("APPROVAL_PASSWORD", "");

    for (const nodeEnv of ["development", "test", "production"]) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      await expect(hasValidApprovalSession(requestWithCookie(token))).resolves.toBe(false);
      await expect(hasValidApprovalSession(requestWithCookie())).resolves.toBe(false);
    }
  });

  it("fails closed when SESSION_SECRET is not set", async () => {
    const token = await createApprovalSessionToken();
    vi.stubEnv("SESSION_SECRET", "");

    await expect(hasValidApprovalSession(requestWithCookie(token))).resolves.toBe(false);
  });

  it("refuses to create a token when not configured", async () => {
    vi.stubEnv("APPROVAL_PASSWORD", "");

    await expect(createApprovalSessionToken()).rejects.toThrow(/not configured/);
  });
});
