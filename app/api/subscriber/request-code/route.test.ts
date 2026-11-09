import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitStore } from "@/src/server/rate-limit-store";

const db = vi.hoisted(() => {
  const subscriber = { findUnique: vi.fn() };
  const authCode = { updateMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() };
  return {
    prisma: {
      subscriber,
      authCode,
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    },
  };
});
const emailFns = vi.hoisted(() => ({
  sendSubscriberOtpEmail: vi.fn(),
  sendSubscriberWelcomeEmail: vi.fn(),
}));
const limits = vi.hoisted(() => ({ store: null as RateLimitStore | null }));

vi.mock("@/src/server/prisma", () => db);
vi.mock("@/src/features/subscriber/email", () => emailFns);
vi.mock("@/src/server/rate-limit-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/rate-limit-store")>();
  return { ...actual, getRateLimitStore: () => limits.store };
});

import { POST } from "@/app/api/subscriber/request-code/route";
import { createMemoryRateLimitStore } from "@/src/server/rate-limit-store";

const EMAIL = "reader@example.com";

function requestCode(email: string, ip = "203.0.113.7") {
  return POST(
    new Request("http://localhost/api/subscriber/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nf-client-connection-ip": ip },
      body: JSON.stringify({ email }),
    }),
  );
}

function subscriberRow(email: string) {
  const now = new Date("2026-11-01T00:00:00Z");
  return {
    id: 7n,
    email,
    firstName: "Reader",
    status: "active",
    source: "article_gate",
    subscribedAt: now,
    lastSeenAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("POST /api/subscriber/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
    vi.stubEnv("SUBSCRIBER_PROVIDER", "ghl");
    limits.store = createMemoryRateLimitStore();
    db.prisma.subscriber.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) =>
      subscriberRow(where.email),
    );
    db.prisma.authCode.updateMany.mockResolvedValue({ count: 0 });
    db.prisma.authCode.create.mockResolvedValue({ id: 1n });
    db.prisma.authCode.deleteMany.mockResolvedValue({ count: 0 });
    emailFns.sendSubscriberOtpEmail.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("emails a code and records the caller's IP", async () => {
    const response = await requestCode(EMAIL);

    expect(response.status).toBe(200);
    expect(emailFns.sendSubscriberOtpEmail).toHaveBeenCalledWith({ email: EMAIL, code: expect.any(String) });
    expect(db.prisma.authCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: EMAIL, requestIp: "203.0.113.7" }),
    });
  });

  it("sends at most five codes an hour to one email, across IPs", async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await requestCode(EMAIL, `198.51.100.${attempt}`)).status).toBe(200);
    }

    const blocked = await requestCode(EMAIL, "198.51.100.99");

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()).code).toBe("rate_limited");
    expect(emailFns.sendSubscriberOtpEmail).toHaveBeenCalledTimes(5);
    expect((await requestCode("other@example.com", "198.51.100.99")).status).toBe(200);
  });

  it("limits code requests per IP across emails", async () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      expect((await requestCode(`reader${attempt}@example.com`)).status).toBe(200);
    }

    const blocked = await requestCode("fresh@example.com");

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(emailFns.sendSubscriberOtpEmail).toHaveBeenCalledTimes(20);
    expect((await requestCode("fresh@example.com", "198.51.100.1")).status).toBe(200);
  });
});
