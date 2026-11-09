import { createJobToken, isValidJobToken, JOB_TOKEN_TTL_MS } from "@/src/server/job-token";

/**
 * Short-lived tokens that let the publish job ask the site to refresh its cache (POST /api/revalidate).
 * See job-token.ts for how they are signed.
 */

export const CACHE_REFRESH_TOKEN_TTL_MS = JOB_TOKEN_TTL_MS;

export function createCacheRefreshToken(secret: string, now: Date): string {
  return createJobToken("cache-refresh", secret, now);
}

export function isValidCacheRefreshToken(token: string | null | undefined, secret: string, now: Date): boolean {
  return isValidJobToken("cache-refresh", token, secret, now);
}
