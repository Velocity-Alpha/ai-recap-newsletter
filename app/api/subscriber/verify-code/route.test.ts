import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitStore } from "@/src/server/rate-limit-store";

const db = vi.hoisted(() => {
  const subscriber = { findUnique: vi.fn(), update: vi.fn() };
  const authCode = { findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() };
  return { prisma: { subscriber, authCode } };
});
const limits = vi.hoisted(() => ({ store: null as RateLimitStore | null }));

vi.mock("@/src/server/prisma", () => db);
vi.mock("@/src/server/rate-limit-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/rate-limit-store")>();
  return { ...actual, getRateLimitStore: () => limits.store };
});

import { POST } from "@/app/api/subscriber/verify-code/route";
import { hashOneTimeCode } from "@/src/features/subscriber/server";
import { createMemoryRateLimitStore } from "@/src/server/rate-limit-store";

const EMAIL = "reader@example.com";
const CODE = "123456";

function verify(body: { email: string; code: string }, ip = "203.0.113.7") {
  return POST(
    new Request("http://localhost/api/subscriber/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nf-client-connection-ip": ip },
      body: JSON.stringify(body),
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

// One live code per email, consumed by the first successful updateMany, like the table.
function liveCodeFor(code: string) {
  let consumed = false;
  db.prisma.authCode.findFirst.mockImplementation(async ({ where }: { where: { email: string } }) =>
    consumed ? null : { id: 99n, codeHash: hashOneTimeCode(where.email, code) },
  );
  db.prisma.authCode.updateMany.mockImplementation(async () => {
    const count = consumed ? 0 : 1;
    consumed = true;
    return { count };
  });
}

describe("POST /api/subscriber/verify-code", () => {
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
    db.prisma.subscriber.update.mockResolvedValue({});
    db.prisma.authCode.deleteMany.mockResolvedValue({ count: 0 });
    liveCodeFor(CODE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("signs the reader in with the right code", async () => {
    const response = await verify({ email: EMAIL, code: CODE });

    expect(response.status).toBe(200);
    const [session, hint] = response.headers.getSetCookie();
    expect(session).toMatch(/^ai_recap_subscriber=[^;]+;/);
    expect(session).toContain("HttpOnly");
    expect(hint).toMatch(/^ai_recap_signed_in=1;/);
    expect(hint).toContain("Path=/;");
    expect(hint).toContain("Max-Age=2592000;");
    expect(hint).toContain("SameSite=lax");
    expect(hint).not.toContain("HttpOnly");
  });

  it("invalidates a code after five wrong tries, so the right code no longer works", async () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const response = await verify({ email: EMAIL, code: "000000" });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("That code is invalid or expired.");
    }

    const fifth = await verify({ email: EMAIL, code: "000000" });
    expect(fifth.status).toBe(400);
    expect((await fifth.json()).error).toBe("Too many wrong codes. Request a new code.");

    const rightCode = await verify({ email: EMAIL, code: CODE });
    expect(rightCode.status).toBe(400);
    expect(rightCode.headers.get("set-cookie")).toBeNull();
  });

  it("limits tries per email across IPs", async () => {
    db.prisma.authCode.findFirst.mockResolvedValue(null);

    for (let attempt = 1; attempt <= 10; attempt++) {
      expect((await verify({ email: EMAIL, code: "000000" }, `198.51.100.${attempt}`)).status).toBe(400);
    }
    const blocked = await verify({ email: EMAIL, code: CODE }, "198.51.100.99");

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toMatch(/^Too many attempts\. Try again in about \d+ minutes\.$/);
    expect((await verify({ email: "other@example.com", code: "000000" }, "198.51.100.99")).status).toBe(400);
  });

  it("limits tries per IP across emails", async () => {
    db.prisma.authCode.findFirst.mockResolvedValue(null);

    for (let attempt = 1; attempt <= 30; attempt++) {
      expect((await verify({ email: `reader${attempt}@example.com`, code: "000000" })).status).toBe(400);
    }
    const blocked = await verify({ email: "fresh@example.com", code: CODE });

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await verify({ email: "fresh@example.com", code: "000000" }, "198.51.100.1")).status).toBe(400);
  });
});
