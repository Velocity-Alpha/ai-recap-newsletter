import crypto from "node:crypto";

/**
 * Short-lived tokens one part of the system uses to ask another to do a job: the publish job asks the site
 * to refresh its cache, and the ingest schedule starts the background ingest function.
 *
 * They reuse SESSION_SECRET, so no new credential is needed. Each purpose signs with its own key derived
 * from that secret, so a token for one purpose never verifies for another, or as a subscriber session
 * (which signs with the raw secret). A token is `<expiresAtMs>.<signature>`. A leaked token works for a
 * few minutes, for its one purpose.
 */

export type JobTokenPurpose = "cache-refresh" | "ingest-stories";

export const JOB_TOKEN_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

function sign(purpose: JobTokenPurpose, expiresAt: string, secret: string): string {
  const key = crypto.createHmac("sha256", secret).update(`ai-recap/${purpose}/v1`).digest();
  return crypto.createHmac("sha256", key).update(`${purpose}.${expiresAt}`).digest("base64url");
}

export function createJobToken(purpose: JobTokenPurpose, secret: string, now: Date): string {
  const expiresAt = String(now.getTime() + JOB_TOKEN_TTL_MS);
  return `${expiresAt}.${sign(purpose, expiresAt, secret)}`;
}

export function isValidJobToken(
  purpose: JobTokenPurpose,
  token: string | null | undefined,
  secret: string,
  now: Date,
): boolean {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 2) return false;
  const [expiresAt, signature] = parts;
  if (!/^\d+$/.test(expiresAt)) return false;

  // Reject expired tokens, and tokens that live longer than one fresh token would. The two sides run on
  // different machines, so allow for a small clock difference.
  const expiresAtMs = Number(expiresAt);
  const latestExpiry = now.getTime() + JOB_TOKEN_TTL_MS + CLOCK_SKEW_MS;
  if (expiresAtMs <= now.getTime() || expiresAtMs > latestExpiry) return false;

  const expected = Buffer.from(sign(purpose, expiresAt, secret));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Reads `Authorization: Bearer <token>`. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}
