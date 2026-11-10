import { NextResponse } from "next/server";

import { approvalSessionToken } from "@/src/server/approval-auth";
import { logServerWarn } from "@/src/server/observability";
import { consumeRateLimit, describeRetryAfter, type RateLimitRule } from "@/src/server/rate-limit";

/**
 * Counts one call against `rule` for the request's approval session (keyed by a hash of its cookie) and returns
 * the 429 to send when the session is over the limit, or null. Call it after the session check.
 */
export async function approvalSessionLimitResponse(
  request: Request,
  rule: RateLimitRule,
  tooMany: string,
): Promise<NextResponse | null> {
  const limit = await consumeRateLimit(rule, approvalSessionToken(request) ?? "");
  if (limit.allowed) return null;

  logServerWarn("approval.session.rate_limited", { rule: rule.name, calls: limit.count });
  return NextResponse.json(
    { error: `${tooMany} Try again in ${describeRetryAfter(limit.retryAfterSeconds)}.` },
    { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
  );
}
