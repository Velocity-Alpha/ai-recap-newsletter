import { NextResponse, type NextRequest } from "next/server";

import {
  APPROVAL_SESSION_COOKIE_NAME,
  APPROVAL_SESSION_TTL_SECONDS,
  createApprovalSessionToken,
  getApprovalAuthConfig,
} from "@/src/server/approval-auth";
import { getClientIp, rateLimitIpIdentifier } from "@/src/server/client-ip";
import { logServerWarn } from "@/src/server/observability";
import {
  consumeRateLimit,
  describeRetryAfter,
  RATE_LIMITS,
  resetRateLimit,
  type RateLimitResult,
} from "@/src/server/rate-limit";
import { safeEqual } from "@/src/server/safe-compare";

const SITE_WIDE = "all";

function tooManyAttempts(limit: RateLimitResult) {
  return NextResponse.json(
    { error: `Too many attempts. Try again in ${describeRetryAfter(limit.retryAfterSeconds)}.` },
    { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
  );
}

export async function POST(request: NextRequest) {
  const config = getApprovalAuthConfig();
  if (!config) {
    return NextResponse.json({ error: "Approval login is not configured." }, { status: 503 });
  }

  // Every try counts, before the password is checked, so parallel tries cannot slip past the limits.
  // A correct password clears the per-IP count only. Tries the per-IP limit refuses do not reach the
  // site-wide count, so one IP alone cannot use it up.
  const ip = getClientIp(request);
  const ipKey = rateLimitIpIdentifier(ip);
  const ipLimit = await consumeRateLimit(RATE_LIMITS.approvalLogin, ipKey);
  if (!ipLimit.allowed) {
    logServerWarn("approval.login.rate_limited", { scope: "ip", ip, attempts: ipLimit.count });
    return tooManyAttempts(ipLimit);
  }

  const siteLimit = await consumeRateLimit(RATE_LIMITS.approvalLoginSiteWide, SITE_WIDE);
  if (!siteLimit.allowed) {
    logServerWarn("approval.login.rate_limited", { scope: "site", ip, attempts: siteLimit.count });
    return tooManyAttempts(siteLimit);
  }

  const body = await request.json().catch(() => ({}));
  const password = (body as { password?: unknown } | null)?.password;

  if (typeof password !== "string" || !password || !safeEqual(password, config.password)) {
    return NextResponse.json({ error: "Password incorrect." }, { status: 401 });
  }

  await resetRateLimit(RATE_LIMITS.approvalLogin, ipKey);
  const token = await createApprovalSessionToken(config);
  const response = NextResponse.json({ success: true });

  response.cookies.set(APPROVAL_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: APPROVAL_SESSION_TTL_SECONDS,
  });

  return response;
}
