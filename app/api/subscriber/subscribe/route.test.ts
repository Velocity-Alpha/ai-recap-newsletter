import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitStore } from "@/src/server/rate-limit-store";

const db = vi.hoisted(() => {
  const now = new Date("2026-11-01T00:00:00Z");
  const row = (email: string) => ({
    id: 8n,
    email,
    firstName: "Reader",
    status: "active",
    source: "article_gate",
    subscribedAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const tx = {
    subscriber: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: { email: string } }) => row(data.email)),
    },
  };
  return {
    prisma: {
      subscriber: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  };
});
const ghlFns = vi.hoisted(() => ({ submitSubscriberToGhl: vi.fn() }));
const limits = vi.hoisted(() => ({ store: null as RateLimitStore | null }));

vi.mock("@/src/server/prisma", () => db);
vi.mock("@/src/features/subscriber/ghl", () => ghlFns);
vi.mock("@/src/server/rate-limit-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/rate-limit-store")>();
  return { ...actual, getRateLimitStore: () => limits.store };
});

import { POST } from "@/app/api/subscriber/subscribe/route";
import { createMemoryRateLimitStore } from "@/src/server/rate-limit-store";

function subscribe(email: string, ip = "203.0.113.7") {
  return POST(
    new Request("http://localhost/api/subscriber/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nf-client-connection-ip": ip },
      body: JSON.stringify({ firstName: "Reader", email, source: "article_gate", path: "/issues/test" }),
    }),
  );
}

describe("POST /api/subscriber/subscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
    vi.stubEnv("SUBSCRIBER_PROVIDER", "ghl");
    limits.store = createMemoryRateLimitStore();
    db.prisma.subscriber.findUnique.mockResolvedValue(null);
    ghlFns.submitSubscriberToGhl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("subscribes a new reader and starts a session", async () => {
    const response = await subscribe("reader@example.com");

    expect(response.status).toBe(200);
    expect(ghlFns.submitSubscriberToGhl).toHaveBeenCalledTimes(1);
    const [session, hint] = response.headers.getSetCookie();
    expect(session).toMatch(/^ai_recap_subscriber=[^;]+;/);
    expect(session).toContain("HttpOnly");
    expect(hint).toMatch(/^ai_recap_signed_in=1;/);
    expect(hint).toContain("Path=/;");
    expect(hint).toContain("Max-Age=2592000;");
    expect(hint).toContain("SameSite=lax");
    expect(hint).not.toContain("HttpOnly");
  });

  it("limits sign-ups per email across IPs", async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await subscribe("reader@example.com", `198.51.100.${attempt}`)).status).toBe(200);
    }

    const blocked = await subscribe("Reader@Example.com", "198.51.100.99");

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("set-cookie")).toBeNull();
    expect(ghlFns.submitSubscriberToGhl).toHaveBeenCalledTimes(5);
  });

  it("limits sign-ups per IP across emails", async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      expect((await subscribe(`reader${attempt}@example.com`)).status).toBe(200);
    }

    const blocked = await subscribe("fresh@example.com");

    expect(blocked.status).toBe(429);
    expect(ghlFns.submitSubscriberToGhl).toHaveBeenCalledTimes(10);
    expect((await subscribe("fresh@example.com", "198.51.100.1")).status).toBe(200);
  });
});
