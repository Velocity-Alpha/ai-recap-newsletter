import { normalizeSubscriberEmail } from "@/features/subscriber/identity";
import { createSignedToken, verifySignedToken } from "@/features/subscriber/signing";

const UNSUBSCRIBE_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

type SubscriberUnsubscribeTokenPayload = {
  purpose: "unsubscribe";
  email: string;
  issuedAt: number;
  expiresAt: number;
};

function isValidSubscriberUnsubscribePayload(payload: SubscriberUnsubscribeTokenPayload) {
  return Boolean(
    payload.purpose === "unsubscribe" &&
    payload.email &&
    payload.expiresAt &&
    payload.expiresAt > Date.now(),
  );
}

export function createSubscriberUnsubscribeToken(email: string) {
  const now = Date.now();

  return createSignedToken({
    purpose: "unsubscribe",
    email: normalizeSubscriberEmail(email),
    issuedAt: now,
    expiresAt: now + UNSUBSCRIBE_TOKEN_MAX_AGE_SECONDS * 1000,
  } satisfies SubscriberUnsubscribeTokenPayload);
}

export function verifySubscriberUnsubscribeToken(token: string | undefined | null) {
  return verifySignedToken<SubscriberUnsubscribeTokenPayload>(token, isValidSubscriberUnsubscribePayload);
}
