import crypto from "node:crypto";

import { getRateLimitStore, type RateLimitStore } from "@/src/server/rate-limit-store";

/** At most `limit` hits per identifier in each window of `windowSeconds`. */
export type RateLimitRule = { name: string; limit: number; windowSeconds: number };

export type RateLimitResult = { allowed: boolean; count: number; retryAfterSeconds: number };

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const RATE_LIMITS = {
  /** Approval board password tries per IP. A correct password clears the count. */
  approvalLogin: { name: "approval-login:ip", limit: 5, windowSeconds: 15 * MINUTE },
  subscribeByIp: { name: "subscribe:ip", limit: 10, windowSeconds: HOUR },
  subscribeByEmail: { name: "subscribe:email", limit: 5, windowSeconds: HOUR },
  requestCodeByIp: { name: "request-code:ip", limit: 20, windowSeconds: HOUR },
  requestCodeByEmail: { name: "request-code:email", limit: 5, windowSeconds: HOUR },
  verifyCodeByIp: { name: "verify-code:ip", limit: 30, windowSeconds: HOUR },
  verifyCodeByEmail: { name: "verify-code:email", limit: 10, windowSeconds: HOUR },
  /** Tries per sign-in code (keyed by the code's id). The window outlives the code's 10 minutes. */
  signInCodeTries: { name: "sign-in-code", limit: 5, windowSeconds: 15 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

// Keys hold a hash, so the table stores no email or IP address.
function keyFor(rule: RateLimitRule, identifier: string) {
  return `${rule.name}:${crypto.createHash("sha256").update(identifier, "utf8").digest("hex")}`;
}

/** Counts one hit for the identifier and says whether it is within the rule's limit. */
export async function consumeRateLimit(
  rule: RateLimitRule,
  identifier: string,
  store: RateLimitStore = getRateLimitStore(),
): Promise<RateLimitResult> {
  const { count, retryAfterSeconds } = await store.hit(keyFor(rule, identifier), rule.windowSeconds);
  return { allowed: count <= rule.limit, count, retryAfterSeconds };
}

export async function resetRateLimit(
  rule: RateLimitRule,
  identifier: string,
  store: RateLimitStore = getRateLimitStore(),
): Promise<void> {
  await store.reset(keyFor(rule, identifier));
}

/** "about 3 minutes", for messages that tell people when to try again. */
export function describeRetryAfter(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}
