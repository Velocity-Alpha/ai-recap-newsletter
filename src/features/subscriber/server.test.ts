import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const subscriber = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const authCode = {
    updateMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  };

  return {
    prisma: {
      subscriber,
      authCode,
      $transaction: vi.fn(async (arg: unknown) => {
        if (typeof arg === "function") {
          return arg({ subscriber, authCode });
        }

        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }

        return arg;
      }),
    },
  };
});

vi.mock("@/src/server/prisma", () => prismaMock);

import {
  cleanupExpiredOneTimeCodes,
  consumeOneTimeCode,
  createOneTimeCode,
  createSubscriberSessionToken,
  hasActiveSubscriberSession,
  deleteOneTimeCode,
  findSubscriberByEmail,
  findSubscriberById,
  findSubscriberByIdSafely,
  markSubscriberUnsubscribed,
  storeOneTimeCode,
  upsertSubscriber,
  verifySubscriberSessionToken,
} from "@/src/features/subscriber/server";

describe("subscriber server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps subscriber lookups by email and id", async () => {
    prismaMock.prisma.subscriber.findUnique
      .mockResolvedValueOnce({
        id: 11n,
        email: "reader@example.com",
        firstName: "Reader",
        status: "active",
        source: "article_gate",
        subscribedAt: new Date("2026-04-03T12:00:00.000Z"),
        lastSeenAt: null,
        createdAt: new Date("2026-04-03T12:00:00.000Z"),
        updatedAt: new Date("2026-04-03T12:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: 12n,
        email: "another@example.com",
        firstName: null,
        status: "unsubscribed",
        source: "ghl_import",
        subscribedAt: new Date("2026-04-04T12:00:00.000Z"),
        lastSeenAt: new Date("2026-04-05T12:00:00.000Z"),
        createdAt: new Date("2026-04-04T12:00:00.000Z"),
        updatedAt: new Date("2026-04-05T12:00:00.000Z"),
      });

    await expect(findSubscriberByEmail(" Reader@example.com ")).resolves.toMatchObject({
      id: 11,
      email: "reader@example.com",
      firstName: "Reader",
      status: "active",
    });

    await expect(findSubscriberById(12)).resolves.toMatchObject({
      id: 12,
      email: "another@example.com",
      status: "unsubscribed",
      lastSeenAt: "2026-04-05T12:00:00.000Z",
    });
  });

  it("returns null safely when subscriber lookup throws", async () => {
    prismaMock.prisma.subscriber.findUnique.mockRejectedValueOnce(new Error("boom"));

    await expect(findSubscriberByIdSafely(99)).resolves.toBeNull();
  });

  it("reports an active subscriber session when the cookie and subscriber match", async () => {
    const token = createSubscriberSessionToken({
      subscriberId: 42,
      email: "reader@example.com",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    prismaMock.prisma.subscriber.findUnique.mockResolvedValueOnce({
      id: 42n,
      email: "reader@example.com",
      firstName: "Reader",
      status: "active",
      source: "article_gate",
      subscribedAt: new Date("2026-04-03T12:00:00.000Z"),
      lastSeenAt: null,
      createdAt: new Date("2026-04-03T12:00:00.000Z"),
      updatedAt: new Date("2026-04-03T12:00:00.000Z"),
    });

    await expect(
      hasActiveSubscriberSession({
        get: () => ({ name: "ai_recap_subscriber", value: token }),
      }),
    ).resolves.toBe(true);
  });

  it("returns false when the subscriber session cookie is missing", async () => {
    await expect(
      hasActiveSubscriberSession({
        get: () => undefined,
      }),
    ).resolves.toBe(false);

    expect(prismaMock.prisma.subscriber.findUnique).not.toHaveBeenCalled();
  });

  it("creates a subscriber when none exists", async () => {
    prismaMock.prisma.subscriber.findUnique.mockResolvedValueOnce(null);
    prismaMock.prisma.subscriber.create.mockResolvedValueOnce({
      id: 20n,
      email: "reader@example.com",
      firstName: "Reader",
      status: "active",
      source: "article_gate",
      subscribedAt: new Date("2026-04-06T12:00:00.000Z"),
      lastSeenAt: new Date("2026-04-06T12:00:00.000Z"),
      createdAt: new Date("2026-04-06T12:00:00.000Z"),
      updatedAt: new Date("2026-04-06T12:00:00.000Z"),
    });

    const result = await upsertSubscriber({
      email: " Reader@example.com ",
      firstName: "Reader",
      source: "article_gate",
      status: "active",
    });

    expect(prismaMock.prisma.subscriber.create).toHaveBeenCalled();
    expect(result.id).toBe(20);
    expect(result.firstName).toBe("Reader");
  });

  it("updates an existing subscriber while preserving source and active subscribed date", async () => {
    const existing = {
      id: 21n,
      email: "reader@example.com",
      firstName: "Old Name",
      status: "active",
      source: "existing_source",
      subscribedAt: new Date("2026-04-01T12:00:00.000Z"),
      lastSeenAt: null,
      createdAt: new Date("2026-04-01T12:00:00.000Z"),
      updatedAt: new Date("2026-04-01T12:00:00.000Z"),
    };

    prismaMock.prisma.subscriber.findUnique.mockResolvedValueOnce(existing);
    prismaMock.prisma.subscriber.update.mockResolvedValueOnce({
      ...existing,
      firstName: "Old Name",
      status: "unsubscribed",
      lastSeenAt: new Date("2026-04-07T12:00:00.000Z"),
      updatedAt: new Date("2026-04-07T12:00:00.000Z"),
    });

    await upsertSubscriber({
      email: "reader@example.com",
      firstName: null,
      source: "article_gate",
      status: "unsubscribed",
    });

    expect(prismaMock.prisma.subscriber.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "reader@example.com" },
        data: expect.objectContaining({
          firstName: "Old Name",
          source: "existing_source",
          subscribedAt: existing.subscribedAt,
          status: "unsubscribed",
        }),
      }),
    );
  });

  it("stores a fresh one-time code after consuming previous active ones", async () => {
    prismaMock.prisma.authCode.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.prisma.authCode.create.mockResolvedValueOnce({
      id: 1n,
    });

    await storeOneTimeCode({
      email: "reader@example.com",
      code: "123456",
      requestIp: "127.0.0.1",
      requestUserAgent: "Vitest",
    });

    expect(prismaMock.prisma.authCode.updateMany).toHaveBeenCalled();
    expect(prismaMock.prisma.authCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "reader@example.com",
          purpose: "sign_in",
          requestIp: "127.0.0.1",
          requestUserAgent: "Vitest",
        }),
      }),
    );
  });

  it("consumes the most recent valid one-time code", async () => {
    prismaMock.prisma.authCode.findFirst.mockResolvedValueOnce({
      id: 55n,
      email: "reader@example.com",
      codeHash: "hash",
      purpose: "sign_in",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date(),
    });
    prismaMock.prisma.authCode.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(consumeOneTimeCode("reader@example.com", "123456")).resolves.toBe(true);
  });

  it("returns false when no valid one-time code exists", async () => {
    prismaMock.prisma.authCode.findFirst.mockResolvedValueOnce(null);

    await expect(consumeOneTimeCode("reader@example.com", "123456")).resolves.toBe(false);
  });

  it("deletes matching active one-time codes and cleans up old codes", async () => {
    prismaMock.prisma.authCode.deleteMany.mockResolvedValue({ count: 1 });

    await deleteOneTimeCode("reader@example.com", "123456");
    await cleanupExpiredOneTimeCodes();

    expect(prismaMock.prisma.authCode.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("marks a subscriber unsubscribed when present", async () => {
    prismaMock.prisma.subscriber.findUnique.mockResolvedValueOnce({
      id: 30n,
      email: "reader@example.com",
      firstName: "Reader",
      status: "active",
      source: "article_gate",
      subscribedAt: new Date("2026-04-01T12:00:00.000Z"),
      lastSeenAt: null,
      createdAt: new Date("2026-04-01T12:00:00.000Z"),
      updatedAt: new Date("2026-04-01T12:00:00.000Z"),
    });
    prismaMock.prisma.subscriber.update.mockResolvedValueOnce({
      id: 30n,
      email: "reader@example.com",
      firstName: "Reader",
      status: "unsubscribed",
      source: "article_gate",
      subscribedAt: new Date("2026-04-01T12:00:00.000Z"),
      lastSeenAt: new Date("2026-04-08T12:00:00.000Z"),
      createdAt: new Date("2026-04-01T12:00:00.000Z"),
      updatedAt: new Date("2026-04-08T12:00:00.000Z"),
    });

    await expect(markSubscriberUnsubscribed({ email: "reader@example.com" })).resolves.toMatchObject({
      status: "unsubscribed",
    });
  });

  it("still signs and verifies session tokens", () => {
    const token = createSubscriberSessionToken({
      subscriberId: 42,
      email: "reader@example.com",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    expect(verifySubscriberSessionToken(token)).toMatchObject({
      subscriberId: 42,
      email: "reader@example.com",
    });
  });

  it("generates six-digit codes", () => {
    expect(createOneTimeCode()).toMatch(/^\d{6}$/);
  });
});
