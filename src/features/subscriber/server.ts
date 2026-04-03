import crypto from "crypto";
import { cookies } from "next/headers";
import type { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { Pool } from "pg";

import type { SubscriberRecord, SubscriberSessionPayload } from "@/src/features/subscriber/types";

const COOKIE_NAME = "ai_recap_subscriber";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;

let pool: Pool | null = null;

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return databaseUrl;
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  return pool;
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET?.trim();

  if (!secret) {
    throw new Error("SESSION_SECRET is not configured.");
  }

  return secret;
}

export function normalizeSubscriberEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidSubscriberEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function signValue(value: string) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

function serializeSessionPayload(payload: SubscriberSessionPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function deserializeSessionPayload(value: string) {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return JSON.parse(decoded) as SubscriberSessionPayload;
  } catch {
    return null;
  }
}

export function createSubscriberSessionToken(payload: SubscriberSessionPayload) {
  const encodedPayload = serializeSessionPayload(payload);
  const signature = signValue(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifySubscriberSessionToken(token: string | undefined | null) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  const payload = deserializeSessionPayload(encodedPayload);
  if (!payload) {
    return null;
  }

  if (!payload.subscriberId || !payload.email || !payload.expiresAt) {
    return null;
  }

  if (payload.expiresAt <= Date.now()) {
    return null;
  }

  return payload;
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function buildSubscriberSessionPayload(subscriber: SubscriberRecord): SubscriberSessionPayload {
  const now = Date.now();

  return {
    subscriberId: subscriber.id,
    email: subscriber.email,
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000,
  };
}

export function setSubscriberSessionCookie(
  cookieStore: ResponseCookies,
  subscriber: SubscriberRecord,
) {
  const token = createSubscriberSessionToken(buildSubscriberSessionPayload(subscriber));
  cookieStore.set(COOKIE_NAME, token, getCookieOptions());
}

export function clearSubscriberSessionCookie(cookieStore: ResponseCookies) {
  cookieStore.set(COOKIE_NAME, "", {
    ...getCookieOptions(),
    maxAge: 0,
  });
}

export async function getSubscriberSessionFromCookies(
  cookieStore?: CookieReader,
) {
  const resolvedCookies = cookieStore ?? (await cookies());
  const token = resolvedCookies.get(COOKIE_NAME)?.value;
  return verifySubscriberSessionToken(token);
}

function mapSubscriberRow(row: Record<string, unknown>): SubscriberRecord {
  return {
    id: Number(row.id),
    email: String(row.email),
    firstName: row.first_name ? String(row.first_name) : null,
    status: String(row.status) as SubscriberRecord["status"],
    source: String(row.source),
    subscribedAt: String(row.subscribed_at),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function findSubscriberByEmail(email: string) {
  const normalizedEmail = normalizeSubscriberEmail(email);
  const result = await getPool().query(
    `SELECT id, email, first_name, status, source, subscribed_at, last_seen_at, created_at, updated_at
     FROM newsletter.subscribers
     WHERE email = $1`,
    [normalizedEmail],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapSubscriberRow(result.rows[0]);
}

export async function findSubscriberById(id: number) {
  const result = await getPool().query(
    `SELECT id, email, first_name, status, source, subscribed_at, last_seen_at, created_at, updated_at
     FROM newsletter.subscribers
     WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapSubscriberRow(result.rows[0]);
}

export async function upsertSubscriber(input: {
  email: string;
  firstName?: string | null;
  source: string;
  status?: SubscriberRecord["status"];
}) {
  const normalizedEmail = normalizeSubscriberEmail(input.email);
  const normalizedFirstName = input.firstName?.trim() || null;
  const result = await getPool().query(
    `INSERT INTO newsletter.subscribers (
       email,
       first_name,
       status,
       source,
       subscribed_at,
       last_seen_at
     )
     VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (email)
     DO UPDATE SET
       status = EXCLUDED.status,
       first_name = COALESCE(EXCLUDED.first_name, newsletter.subscribers.first_name),
       source = COALESCE(newsletter.subscribers.source, EXCLUDED.source),
       subscribed_at = CASE
         WHEN newsletter.subscribers.status = 'active' THEN newsletter.subscribers.subscribed_at
         ELSE now()
       END,
       last_seen_at = now()
     RETURNING id, email, first_name, status, source, subscribed_at, last_seen_at, created_at, updated_at`,
    [normalizedEmail, normalizedFirstName, input.status ?? "active", input.source],
  );

  return mapSubscriberRow(result.rows[0]);
}

export async function touchSubscriberSeenAt(id: number) {
  await getPool().query(
    `UPDATE newsletter.subscribers
     SET last_seen_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function markSubscriberUnsubscribed(input: {
  email: string;
}) {
  const normalizedEmail = normalizeSubscriberEmail(input.email);

  const result = await getPool().query(
    `UPDATE newsletter.subscribers
     SET status = 'unsubscribed',
         last_seen_at = now()
     WHERE email = $1
     RETURNING id, email, first_name, status, source, subscribed_at, last_seen_at, created_at, updated_at`,
    [normalizedEmail],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapSubscriberRow(result.rows[0]);
}

export function createOneTimeCode() {
  const randomNumber = crypto.randomInt(0, 10 ** OTP_LENGTH);
  return randomNumber.toString().padStart(OTP_LENGTH, "0");
}

export function hashOneTimeCode(email: string, code: string) {
  return crypto
    .createHash("sha256")
    .update(`${normalizeSubscriberEmail(email)}:${code}:${getSessionSecret()}`)
    .digest("hex");
}

export function getOtpExpiryDate() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

export async function storeOneTimeCode(input: {
  email: string;
  code: string;
  requestIp?: string | null;
  requestUserAgent?: string | null;
}) {
  const normalizedEmail = normalizeSubscriberEmail(input.email);
  const codeHash = hashOneTimeCode(normalizedEmail, input.code);

  await getPool().query(
    `UPDATE newsletter.auth_codes
     SET consumed_at = now()
     WHERE email = $1
       AND purpose = 'sign_in'
       AND consumed_at IS NULL`,
    [normalizedEmail],
  );

  await getPool().query(
    `INSERT INTO newsletter.auth_codes (
       email,
       code_hash,
       purpose,
       expires_at,
       request_ip,
       request_user_agent
     )
     VALUES ($1, $2, 'sign_in', $3, $4, $5)`,
    [normalizedEmail, codeHash, getOtpExpiryDate(), input.requestIp ?? null, input.requestUserAgent ?? null],
  );
}

export async function consumeOneTimeCode(email: string, code: string) {
  const normalizedEmail = normalizeSubscriberEmail(email);
  const codeHash = hashOneTimeCode(normalizedEmail, code);

  const result = await getPool().query(
    `UPDATE newsletter.auth_codes
     SET consumed_at = now()
     WHERE id = (
       SELECT id
       FROM newsletter.auth_codes
       WHERE email = $1
         AND code_hash = $2
         AND purpose = 'sign_in'
         AND consumed_at IS NULL
         AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1
     )
     RETURNING id`,
    [normalizedEmail, codeHash],
  );

  return result.rows.length > 0;
}

export async function deleteOneTimeCode(email: string, code: string) {
  const normalizedEmail = normalizeSubscriberEmail(email);
  const codeHash = hashOneTimeCode(normalizedEmail, code);

  await getPool().query(
    `DELETE FROM newsletter.auth_codes
     WHERE email = $1
       AND code_hash = $2
       AND purpose = 'sign_in'
       AND consumed_at IS NULL`,
    [normalizedEmail, codeHash],
  );
}

export async function cleanupExpiredOneTimeCodes() {
  await getPool().query(
    `DELETE FROM newsletter.auth_codes
     WHERE created_at < now() - interval '7 days'`,
  );
}
