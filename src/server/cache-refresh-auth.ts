import crypto from "node:crypto";

/**
 * Short-lived tokens that let the publish job ask the site to refresh its cache (POST /api/revalidate).
 *
 * They reuse SESSION_SECRET, so no new credential is needed. The signing key is derived from it, so a
 * refresh token never verifies as a subscriber session (which signs with the raw secret), and the other
 * way around. A token is `<expiresAtMs>.<signature>`. A leaked token can only refresh the cache for a few
 * minutes.
 */

export const CACHE_REFRESH_TOKEN_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

function signingKey(secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update("ai-recap/cache-refresh/v1").digest();
}

function sign(expiresAt: string, secret: string): string {
  return crypto.createHmac("sha256", signingKey(secret)).update(`cache-refresh.${expiresAt}`).digest("base64url");
}

export function createCacheRefreshToken(secret: string, now: Date): string {
  const expiresAt = String(now.getTime() + CACHE_REFRESH_TOKEN_TTL_MS);
  return `${expiresAt}.${sign(expiresAt, secret)}`;
}

export function isValidCacheRefreshToken(token: string | null | undefined, secret: string, now: Date): boolean {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 2) return false;
  const [expiresAt, signature] = parts;
  if (!/^\d+$/.test(expiresAt)) return false;

  // Reject expired tokens, and tokens that live longer than one fresh token would. The job and the site run
  // on different machines, so allow for a small clock difference.
  const expiresAtMs = Number(expiresAt);
  const latestExpiry = now.getTime() + CACHE_REFRESH_TOKEN_TTL_MS + CLOCK_SKEW_MS;
  if (expiresAtMs <= now.getTime() || expiresAtMs > latestExpiry) return false;

  const expected = Buffer.from(sign(expiresAt, secret));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
