import { cookies } from "next/headers";
import type { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";

import { findSubscriberByIdSafely } from "@/features/subscriber/repository";
import { createSignedToken, verifySignedToken } from "@/features/subscriber/signing";
import type { SubscriberRecord, SubscriberSessionPayload } from "@/features/subscriber/types";

const COOKIE_NAME = "ai_recap_subscriber";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

function isValidSubscriberSessionPayload(payload: SubscriberSessionPayload) {
  return Boolean(
    payload.subscriberId &&
    payload.email &&
    payload.expiresAt &&
    payload.expiresAt > Date.now(),
  );
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

export function createSubscriberSessionToken(payload: SubscriberSessionPayload) {
  return createSignedToken(payload);
}

export function verifySubscriberSessionToken(token: string | undefined | null) {
  return verifySignedToken<SubscriberSessionPayload>(token, isValidSubscriberSessionPayload);
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

export async function getSubscriberSessionFromCookies(cookieStore?: CookieReader) {
  const resolvedCookies = cookieStore ?? (await cookies());
  const token = resolvedCookies.get(COOKIE_NAME)?.value;
  return verifySubscriberSessionToken(token);
}

export async function hasActiveSubscriberSession(cookieStore?: CookieReader) {
  const session = await getSubscriberSessionFromCookies(cookieStore);

  if (!session) {
    return false;
  }

  const subscriber = await findSubscriberByIdSafely(session.subscriberId);

  return Boolean(
    subscriber &&
    subscriber.status === "active" &&
    subscriber.email === session.email,
  );
}
