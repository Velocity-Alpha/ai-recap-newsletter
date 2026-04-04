import crypto from "crypto";
import { cookies } from "next/headers";
import type { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";

import type { SubscriberRecord, SubscriberSessionPayload } from "@/src/features/subscriber/types";
import { prisma } from "@/src/server/prisma";

const COOKIE_NAME = "ai_recap_subscriber";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

type SubscriberRow = {
  id: bigint;
  email: string;
  firstName: string | null;
  status: string;
  source: string;
  subscribedAt: Date;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

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

function mapSubscriberRecord(record: SubscriberRow): SubscriberRecord {
  return {
    id: Number(record.id),
    email: record.email,
    firstName: record.firstName,
    status: record.status as SubscriberRecord["status"],
    source: record.source,
    subscribedAt: record.subscribedAt.toISOString(),
    lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
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

export async function findSubscriberByEmail(email: string) {
  const record = await prisma.subscriber.findUnique({
    where: { email: normalizeSubscriberEmail(email) },
  });

  return record ? mapSubscriberRecord(record) : null;
}

export async function findSubscriberById(id: number) {
  const record = await prisma.subscriber.findUnique({
    where: { id: BigInt(id) },
  });

  return record ? mapSubscriberRecord(record) : null;
}

export async function findSubscriberByIdSafely(id: number) {
  try {
    return await findSubscriberById(id);
  } catch {
    return null;
  }
}

export async function upsertSubscriber(input: {
  email: string;
  firstName?: string | null;
  source: string;
  status?: SubscriberRecord["status"];
}) {
  const normalizedEmail = normalizeSubscriberEmail(input.email);
  const normalizedFirstName = input.firstName?.trim() || null;
  const nextStatus = input.status ?? "active";
  const now = new Date();

  const record = await prisma.$transaction(async (tx) => {
    const existing = await tx.subscriber.findUnique({
      where: { email: normalizedEmail },
    });

    if (!existing) {
      return tx.subscriber.create({
        data: {
          email: normalizedEmail,
          firstName: normalizedFirstName,
          status: nextStatus,
          source: input.source,
          subscribedAt: now,
          lastSeenAt: now,
        },
      });
    }

    return tx.subscriber.update({
      where: { email: normalizedEmail },
      data: {
        status: nextStatus,
        firstName: normalizedFirstName ?? existing.firstName,
        source: existing.source,
        subscribedAt: existing.status === "active" ? existing.subscribedAt : now,
        lastSeenAt: now,
      },
    });
  });

  return mapSubscriberRecord(record);
}

export async function touchSubscriberSeenAt(id: number) {
  await prisma.subscriber.update({
    where: { id: BigInt(id) },
    data: {
      lastSeenAt: new Date(),
    },
  });
}

export async function markSubscriberUnsubscribed(input: {
  email: string;
}) {
  const normalizedEmail = normalizeSubscriberEmail(input.email);
  const existing = await prisma.subscriber.findUnique({
    where: { email: normalizedEmail },
  });

  if (!existing) {
    return null;
  }

  const record = await prisma.subscriber.update({
    where: { email: normalizedEmail },
    data: {
      status: "unsubscribed",
      lastSeenAt: new Date(),
    },
  });

  return mapSubscriberRecord(record);
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

  await prisma.$transaction([
    prisma.authCode.updateMany({
      where: {
        email: normalizedEmail,
        purpose: "sign_in",
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    }),
    prisma.authCode.create({
      data: {
        email: normalizedEmail,
        codeHash,
        purpose: "sign_in",
        expiresAt: getOtpExpiryDate(),
        requestIp: input.requestIp ?? null,
        requestUserAgent: input.requestUserAgent ?? null,
      },
    }),
  ]);
}

export async function consumeOneTimeCode(email: string, code: string) {
  const normalizedEmail = normalizeSubscriberEmail(email);
  const codeHash = hashOneTimeCode(normalizedEmail, code);

  return prisma.$transaction(async (tx) => {
    const authCode = await tx.authCode.findFirst({
      where: {
        email: normalizedEmail,
        codeHash,
        purpose: "sign_in",
        consumedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!authCode) {
      return false;
    }

    const result = await tx.authCode.updateMany({
      where: {
        id: authCode.id,
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    return result.count > 0;
  });
}

export async function deleteOneTimeCode(email: string, code: string) {
  const normalizedEmail = normalizeSubscriberEmail(email);
  const codeHash = hashOneTimeCode(normalizedEmail, code);

  await prisma.authCode.deleteMany({
    where: {
      email: normalizedEmail,
      codeHash,
      purpose: "sign_in",
      consumedAt: null,
    },
  });
}

export async function cleanupExpiredOneTimeCodes() {
  await prisma.authCode.deleteMany({
    where: {
      createdAt: {
        lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    },
  });
}
