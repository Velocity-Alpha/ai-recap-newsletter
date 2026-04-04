import crypto from "node:crypto";

import { NextResponse } from "next/server";

type LogLevel = "info" | "warn" | "error";

type LogMetadata = Record<string, unknown>;

export type RequestLogContext = {
  requestId: string;
  route: string;
  method: string;
  pathname: string;
  search: string;
  ip: string | null;
  userAgent: string | null;
  startedAt: number;
};

function writeLog(level: LogLevel, event: string, metadata: LogMetadata) {
  console[level](`[observability] ${event}`, metadata);
}

export function createRequestLogContext(route: string, request: Request): RequestLogContext {
  const url = new URL(request.url);

  return {
    requestId: request.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
    route,
    method: request.method,
    pathname: url.pathname,
    search: url.search,
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
    startedAt: Date.now(),
  };
}

function buildBaseMetadata(context: RequestLogContext): LogMetadata {
  return {
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    pathname: context.pathname,
    search: context.search,
    ip: context.ip,
    userAgent: context.userAgent,
  };
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    const details = error as Error & { code?: string; statusCode?: number; cause?: unknown };

    return {
      name: details.name,
      message: details.message,
      stack: details.stack,
      code: details.code,
      statusCode: details.statusCode,
      cause: details.cause,
    };
  }

  return {
    value: error,
  };
}

export function maskEmail(email: string | null | undefined) {
  if (!email) {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const [localPart, domain] = normalizedEmail.split("@");

  if (!localPart || !domain) {
    return normalizedEmail;
  }

  const visibleLocal = localPart.slice(0, Math.min(3, localPart.length));
  return `${visibleLocal}***@${domain}`;
}

export function logRequestStart(context: RequestLogContext, metadata: LogMetadata = {}) {
  writeLog("info", "request.start", {
    ...buildBaseMetadata(context),
    ...metadata,
  });
}

export function logRequestSuccess(context: RequestLogContext, metadata: LogMetadata = {}) {
  writeLog("info", "request.success", {
    ...buildBaseMetadata(context),
    durationMs: Date.now() - context.startedAt,
    ...metadata,
  });
}

export function logRequestWarning(
  context: RequestLogContext,
  message: string,
  metadata: LogMetadata = {},
) {
  writeLog("warn", "request.warning", {
    ...buildBaseMetadata(context),
    durationMs: Date.now() - context.startedAt,
    message,
    ...metadata,
  });
}

export function logRequestError(
  context: RequestLogContext,
  message: string,
  error: unknown,
  metadata: LogMetadata = {},
) {
  writeLog("error", "request.error", {
    ...buildBaseMetadata(context),
    durationMs: Date.now() - context.startedAt,
    message,
    error: serializeError(error),
    ...metadata,
  });
}

export function logServerInfo(event: string, metadata: LogMetadata = {}) {
  writeLog("info", event, metadata);
}

export function logServerWarn(event: string, metadata: LogMetadata = {}) {
  writeLog("warn", event, metadata);
}

export function logServerError(event: string, error: unknown, metadata: LogMetadata = {}) {
  writeLog("error", event, {
    ...metadata,
    error: serializeError(error),
  });
}

export function jsonWithRequestId<T>(
  context: RequestLogContext,
  body: T,
  init?: ResponseInit,
) {
  const headers = new Headers(init?.headers);
  headers.set("X-Request-ID", context.requestId);

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}
