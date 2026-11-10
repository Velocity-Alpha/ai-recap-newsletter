/**
 * Approval board sessions. The login route checks the shared APPROVAL_PASSWORD, then sets a cookie
 * holding `<expiresAtMs>.<nonce>.<signature>`. The signature is an HMAC over the expiry and nonce, keyed by
 * SESSION_SECRET and the password, so:
 * - the server rejects a token after its expiry, whatever the browser keeps;
 * - changing APPROVAL_PASSWORD or SESSION_SECRET ends every session;
 * - the cookie reveals nothing about the password.
 * With either secret unset, no session is valid and no one can sign in.
 *
 * Uses Web Crypto only, because proxy.ts imports it.
 */

export const APPROVAL_SESSION_COOKIE_NAME = "approval_session";
export const APPROVAL_SESSION_TTL_SECONDS = 60 * 60 * 24;
const CLOCK_SKEW_MS = 60 * 1000;
const KEY_CONTEXT = "ai-recap/approval-session/v1";

export type ApprovalAuthConfig = { password: string; sessionSecret: string };

type Env = Record<string, string | undefined>;

export function getApprovalAuthConfig(env: Env = process.env): ApprovalAuthConfig | null {
  const password = env.APPROVAL_PASSWORD?.trim();
  const sessionSecret = env.SESSION_SECRET?.trim();
  if (!password || !sessionSecret) return null;
  return { password, sessionSecret };
}

function requireConfig(): ApprovalAuthConfig {
  const config = getApprovalAuthConfig();
  if (!config) throw new Error("Approval login is not configured. Set APPROVAL_PASSWORD and SESSION_SECRET.");
  return config;
}

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function importHmacKey(raw: ArrayBuffer | Uint8Array<ArrayBuffer>, usages: KeyUsage[]) {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, usages);
}

async function sessionKey(config: ApprovalAuthConfig): Promise<CryptoKey> {
  const base = await importHmacKey(encoder.encode(config.sessionSecret), ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode(`${KEY_CONTEXT}\n${config.password}`));
  return importHmacKey(derived, ["sign", "verify"]);
}

export async function createApprovalSessionToken(
  config: ApprovalAuthConfig = requireConfig(),
  now: Date = new Date(),
): Promise<string> {
  const expiresAt = String(now.getTime() + APPROVAL_SESSION_TTL_SECONDS * 1000);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${expiresAt}.${nonce}`;
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(config), encoder.encode(payload));
  return `${payload}.${toHex(signature)}`;
}

export async function isValidApprovalSessionToken(
  token: string | null | undefined,
  config: ApprovalAuthConfig,
  now: Date = new Date(),
): Promise<boolean> {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, signature] = parts;
  if (!/^\d{1,16}$/.test(expiresAt) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }

  // Reject expired tokens, and tokens that claim to live longer than a fresh one would.
  const expiresAtMs = Number(expiresAt);
  const latestExpiry = now.getTime() + APPROVAL_SESSION_TTL_SECONDS * 1000 + CLOCK_SKEW_MS;
  if (expiresAtMs <= now.getTime() || expiresAtMs > latestExpiry) return false;

  // HMAC verify compares in constant time.
  return crypto.subtle.verify(
    "HMAC",
    await sessionKey(config),
    fromHex(signature),
    encoder.encode(`${expiresAt}.${nonce}`),
  );
}

function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) return cookies;

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookie.trim().split("=");
    if (!rawName || rawValueParts.length === 0) continue;
    try {
      cookies.set(rawName, decodeURIComponent(rawValueParts.join("=")));
    } catch {
      // malformed percent-encoding — skip this cookie
    }
  }

  return cookies;
}

/** The approval session cookie's value, unchecked. Each sign-in gets a new one. */
export function approvalSessionToken(request: Request): string | undefined {
  return parseCookieHeader(request.headers.get("cookie")).get(APPROVAL_SESSION_COOKIE_NAME);
}

/** True when the request carries a valid approval session. False when approval login is not configured. */
export async function hasValidApprovalSession(request: Request, now: Date = new Date()): Promise<boolean> {
  const config = getApprovalAuthConfig();
  if (!config) return false;

  return isValidApprovalSessionToken(approvalSessionToken(request), config, now);
}
