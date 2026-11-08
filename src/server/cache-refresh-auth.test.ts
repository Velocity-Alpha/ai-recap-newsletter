import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CACHE_REFRESH_TOKEN_TTL_MS,
  createCacheRefreshToken,
  isValidCacheRefreshToken,
} from "@/src/server/cache-refresh-auth";

const SECRET = "test-session-secret";
const NOW = new Date("2026-11-09T16:00:00.000Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe("cache refresh tokens", () => {
  it("accepts a fresh token signed with the same secret", () => {
    const token = createCacheRefreshToken(SECRET, NOW);

    expect(isValidCacheRefreshToken(token, SECRET, NOW)).toBe(true);
    expect(isValidCacheRefreshToken(token, SECRET, later(CACHE_REFRESH_TOKEN_TTL_MS - 1))).toBe(true);
  });

  it("rejects an expired token", () => {
    const token = createCacheRefreshToken(SECRET, NOW);

    expect(isValidCacheRefreshToken(token, SECRET, later(CACHE_REFRESH_TOKEN_TTL_MS + 1))).toBe(false);
  });

  it("rejects a token signed with another secret", () => {
    const token = createCacheRefreshToken("another-secret", NOW);

    expect(isValidCacheRefreshToken(token, SECRET, NOW)).toBe(false);
  });

  it("rejects a token whose expiry was changed", () => {
    const [, signature] = createCacheRefreshToken(SECRET, NOW).split(".");
    const extended = `${NOW.getTime() + 24 * 60 * 60 * 1000}.${signature}`;

    expect(isValidCacheRefreshToken(extended, SECRET, NOW)).toBe(false);
  });

  it("rejects a valid-looking token that expires too far in the future", () => {
    const token = createCacheRefreshToken(SECRET, later(24 * 60 * 60 * 1000));

    expect(isValidCacheRefreshToken(token, SECRET, NOW)).toBe(false);
  });

  it("rejects a value signed directly with the secret, so other signed values cannot be reused", () => {
    // Subscriber sessions sign with the raw secret. A refresh token must not verify with that key.
    const expiresAt = String(NOW.getTime() + 60_000);
    const signature = crypto.createHmac("sha256", SECRET).update(expiresAt).digest("base64url");

    expect(isValidCacheRefreshToken(`${expiresAt}.${signature}`, SECRET, NOW)).toBe(false);
  });

  it.each([undefined, null, "", "abc", "1.2.3", ".", "NaN.sig"])("rejects a malformed token: %s", (token) => {
    expect(isValidCacheRefreshToken(token, SECRET, NOW)).toBe(false);
  });
});
