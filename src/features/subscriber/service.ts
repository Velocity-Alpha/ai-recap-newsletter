import {
  cleanupExpiredOneTimeCodes,
  consumeOneTimeCode,
  createOneTimeCode,
  deleteOneTimeCode,
  findSubscriberByEmail,
  isValidSubscriberEmail,
  markSubscriberUnsubscribed,
  normalizeSubscriberEmail,
  storeOneTimeCode,
  touchSubscriberSeenAt,
  upsertSubscriber,
  verifySubscriberUnsubscribeToken,
} from "@/src/features/subscriber/server";
import { sendSubscriberOtpEmail } from "@/src/features/subscriber/email";
import { submitSubscriberToBeehiiv } from "@/src/features/subscriber/beehiiv";
import type { SubscriberRecord } from "@/src/features/subscriber/types";

export class SubscriberError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode = 400, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function validateSubscriberEmail(email: unknown) {
  if (typeof email !== "string" || !isValidSubscriberEmail(email)) {
    throw new SubscriberError("Enter a valid email.", 400);
  }

  return normalizeSubscriberEmail(email);
}

export function validateSubscriberFirstName(firstName: unknown) {
  if (typeof firstName !== "string" || firstName.trim().length === 0) {
    throw new SubscriberError("Enter your first name.", 400);
  }

  return firstName.trim();
}

function shouldRunOpportunisticAuthCodeCleanup() {
  return Math.random() < 0.1;
}

async function maybeCleanupExpiredAuthCodes() {
  if (!shouldRunOpportunisticAuthCodeCleanup()) {
    return;
  }

  await cleanupExpiredOneTimeCodes();
}

export async function subscribeAndUpsertSubscriber(input: {
  firstName: string;
  email: string;
  source: string;
  path: string | null;
}) {
  const normalizedFirstName = validateSubscriberFirstName(input.firstName);
  const normalizedEmail = validateSubscriberEmail(input.email);
  const existingSubscriber = await findSubscriberByEmail(normalizedEmail);

  if (existingSubscriber?.status === "active") {
    throw new SubscriberError(
      "That email is already subscribed. Sign in to continue.",
      409,
      "already_subscribed",
    );
  }

  await submitSubscriberToBeehiiv({
    firstName: normalizedFirstName,
    email: normalizedEmail,
    source: input.source,
    path: input.path,
  });

  const subscriber = await upsertSubscriber({
    email: normalizedEmail,
    firstName: normalizedFirstName,
    source: input.source,
    status: "active",
  });

  return {
    subscriber,
    newlySubscribed: true,
  };
}

export async function requestSubscriberSignInCode(input: {
  email: string;
  requestIp?: string | null;
  requestUserAgent?: string | null;
}) {
  await maybeCleanupExpiredAuthCodes();

  const normalizedEmail = validateSubscriberEmail(input.email);
  const subscriber = await findRequiredActiveSubscriber(normalizedEmail);
  const code = createOneTimeCode();

  await storeOneTimeCode({
    email: normalizedEmail,
    code,
    requestIp: input.requestIp,
    requestUserAgent: input.requestUserAgent,
  });

  try {
    await sendSubscriberOtpEmail({
      email: normalizedEmail,
      code,
    });
  } catch (error) {
    await deleteOneTimeCode(normalizedEmail, code);
    throw error;
  }

  return subscriber;
}

export async function verifySubscriberSignInCode(input: {
  email: string;
  code: string;
}) {
  await maybeCleanupExpiredAuthCodes();

  const normalizedEmail = validateSubscriberEmail(input.email);
  const normalizedCode = input.code.trim();

  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new SubscriberError("Enter the 6-digit code from your email.", 400);
  }

  const subscriber = await findRequiredActiveSubscriber(normalizedEmail);
  const didConsumeCode = await consumeOneTimeCode(normalizedEmail, normalizedCode);

  if (!didConsumeCode) {
    throw new SubscriberError("That code is invalid or expired.", 400);
  }

  await touchSubscriberSeenAt(subscriber.id);
  return subscriber;
}

export async function unsubscribeSubscriber(input: {
  email?: string | null;
}) {
  const normalizedEmail = typeof input.email === "string" && input.email.trim().length > 0
    ? validateSubscriberEmail(input.email)
    : null;

  if (!normalizedEmail) {
    throw new SubscriberError("Provide email.", 400);
  }

  const subscriber = await findSubscriberByEmail(normalizedEmail);

  if (!subscriber) {
    throw new SubscriberError("Subscriber not found.", 404);
  }

  return markSubscriberUnsubscribed({
    email: normalizedEmail,
  });
}

export async function unsubscribeSubscriberByToken(input: {
  token?: string | null;
}) {
  const token = typeof input.token === "string" ? input.token.trim() : "";

  if (!token) {
    return null;
  }

  const payload = verifySubscriberUnsubscribeToken(token);

  if (!payload) {
    return null;
  }

  return markSubscriberUnsubscribed({
    email: payload.email,
  });
}

export async function unsubscribeSubscriberFromWebhook(input: {
  email?: string | null;
}) {
  const normalizedEmail = typeof input.email === "string" && input.email.trim().length > 0
    ? validateSubscriberEmail(input.email)
    : null;

  if (!normalizedEmail) {
    throw new SubscriberError("Provide email.", 400);
  }

  return markSubscriberUnsubscribed({
    email: normalizedEmail,
  });
}

async function findRequiredActiveSubscriber(email: string): Promise<SubscriberRecord> {
  const subscriber = await findSubscriberByEmail(email);

  if (!subscriber) {
    throw new SubscriberError("We couldn't find an active subscription for that email.", 404);
  }

  if (subscriber.status === "unsubscribed") {
    throw new SubscriberError(
      "You unsubscribed from emails. Resubscribe to restore access.",
      404,
      "unsubscribed",
    );
  }

  if (subscriber.status !== "active") {
    throw new SubscriberError("We couldn't find an active subscription for that email.", 404);
  }

  return subscriber;
}
