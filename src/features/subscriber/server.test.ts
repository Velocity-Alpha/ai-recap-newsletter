import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitStore } from "@/src/server/rate-limit-store";

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

const beehiivMock = vi.hoisted(() => ({
  getBeehiivSubscriberStatus: vi.fn(),
}));

const limits = vi.hoisted(() => ({ store: null as RateLimitStore | null }));

vi.mock("@/src/server/prisma", () => prismaMock);
vi.mock("@/src/features/subscriber/beehiiv", () => beehiivMock);
vi.mock("@/src/server/rate-limit-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/rate-limit-store")>();
  return { ...actual, getRateLimitStore: () => limits.store };
});

import {
  cleanupExpiredOneTimeCodes,
  consumeOneTimeCode,
  createOneTimeCode,
  createSubscriberSessionToken,
  deleteOneTimeCode,
  findSubscriberByEmail,
  hashOneTimeCode,
  markSubscriberUnsubscribed,
  storeOneTimeCode,
  upsertSubscriber,
  verifySubscriberSessionToken,
} from "@/src/features/subscriber/server";
import { createMemoryRateLimitStore } from "@/src/server/rate-limit-store";

describe("subscriber server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps queued *Once values, which otherwise leak between tests.
    prismaMock.prisma.subscriber.findUnique.mockReset();
    beehiivMock.getBeehiivSubscriberStatus.mockReset();
    beehiivMock.getBeehiivSubscriberStatus.mockResolvedValue({ status: "active", id: "beehiiv-default" });
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
    vi.stubEnv("SUBSCRIBER_PROVIDER", "");
    prismaMock.prisma.authCode.findFirst.mockReset();
    prismaMock.prisma.authCode.updateMany.mockReset();
    limits.store = createMemoryRateLimitStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps a subscriber lookup by email", async () => {
    prismaMock.prisma.subscriber.findUnique.mockResolvedValueOnce({
      id: 11n,
      email: "reader@example.com",
      firstName: "Reader",
      status: "active",
      source: "article_gate",
      subscribedAt: new Date("2026-04-03T12:00:00.000Z"),
      lastSeenAt: null,
      createdAt: new Date("2026-04-03T12:00:00.000Z"),
      updatedAt: new Date("2026-04-03T12:00:00.000Z"),
    });

    await expect(findSubscriberByEmail(" Reader@example.com ")).resolves.toMatchObject({
      id: 11,
      email: "reader@example.com",
      firstName: "Reader",
      status: "active",
      lastSeenAt: null,
    });
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

  describe("consumeOneTimeCode", () => {
    const email = "reader@example.com";

    // One live code whose row behaves like the table: once consumed, it is no longer found.
    function liveCode(code = "123456", id = 55n) {
      let consumed = false;
      prismaMock.prisma.authCode.findFirst.mockImplementation(async () =>
        consumed ? null : { id, codeHash: hashOneTimeCode(email, code) },
      );
      prismaMock.prisma.authCode.updateMany.mockImplementation(async () => {
        const count = consumed ? 0 : 1;
        consumed = true;
        return { count };
      });
      return { isConsumed: () => consumed };
    }

    it("consumes the email's live code when the code matches", async () => {
      const code = liveCode();

      await expect(consumeOneTimeCode("Reader@Example.com", "123456")).resolves.toBe("consumed");

      expect(code.isConsumed()).toBe(true);
      expect(prismaMock.prisma.authCode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ email, purpose: "sign_in", consumedAt: null }),
        }),
      );
    });

    it("returns invalid when no live code exists", async () => {
      prismaMock.prisma.authCode.findFirst.mockResolvedValueOnce(null);

      await expect(consumeOneTimeCode(email, "123456")).resolves.toBe("invalid");
      expect(prismaMock.prisma.authCode.updateMany).not.toHaveBeenCalled();
    });

    it("keeps the code alive after a wrong try", async () => {
      const code = liveCode();

      await expect(consumeOneTimeCode(email, "000000")).resolves.toBe("invalid");

      expect(code.isConsumed()).toBe(false);
      await expect(consumeOneTimeCode(email, "123456")).resolves.toBe("consumed");
    });

    it("invalidates the code on the fifth wrong try", async () => {
      const code = liveCode();

      for (let attempt = 1; attempt <= 4; attempt++) {
        await expect(consumeOneTimeCode(email, "000000")).resolves.toBe("invalid");
      }
      await expect(consumeOneTimeCode(email, "000000")).resolves.toBe("too_many_tries");

      expect(code.isConsumed()).toBe(true);
      await expect(consumeOneTimeCode(email, "123456")).resolves.toBe("invalid");
    });

    it("refuses even the right code once a code's tries are used up", async () => {
      prismaMock.prisma.authCode.findFirst.mockResolvedValue({ id: 56n, codeHash: hashOneTimeCode(email, "123456") });
      prismaMock.prisma.authCode.updateMany.mockResolvedValue({ count: 0 });

      for (let attempt = 1; attempt <= 5; attempt++) {
        await consumeOneTimeCode(email, "000000");
      }

      await expect(consumeOneTimeCode(email, "123456")).resolves.toBe("too_many_tries");
    });

    it("gives a new code a fresh set of tries", async () => {
      liveCode("123456", 57n);
      for (let attempt = 1; attempt <= 5; attempt++) {
        await consumeOneTimeCode(email, "000000");
      }

      liveCode("654321", 58n);

      await expect(consumeOneTimeCode(email, "654321")).resolves.toBe("consumed");
    });
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

  describe("findSubscriberByEmail with Beehiiv verification", () => {
    it("returns subscriber when found in DB and active in Beehiiv", async () => {
      prismaMock.prisma.subscriber.findUnique.mockResolvedValueOnce({
        id: 11n,
        email: "reader@example.com",
        firstName: "Reader",
        status: "active",
        source: "article_gate",
        subscribedAt: new Date("2026-04-03T12:00:00.000Z"),
        lastSeenAt: null,
        createdAt: new Date("2026-04-03T12:00:00.000Z"),
        updatedAt: new Date("2026-04-03T12:00:00.000Z"),
      });

      beehiivMock.getBeehiivSubscriberStatus.mockResolvedValueOnce({
        status: "active",
        id: "beehiiv-123",
      });

      const result = await findSubscriberByEmail("reader@example.com");

      expect(result).toMatchObject({
        id: 11,
        email: "reader@example.com",
        status: "active",
      });
      expect(beehiivMock.getBeehiivSubscriberStatus).toHaveBeenCalledWith("reader@example.com");
    });

    it("returns null when subscriber not found in DB", async () => {
      prismaMock.prisma.subscriber.findUnique.mockResolvedValueOnce(null);

      const result = await findSubscriberByEmail("missing@example.com");

      expect(result).toBeNull();
      expect(beehiivMock.getBeehiivSubscriberStatus).not.toHaveBeenCalled();
    });

    it("returns null when subscriber not found in Beehiiv", async () => {
      prismaMock.prisma.subscriber.findUnique.mockResolvedValueOnce({
        id: 11n,
        email: "reader@example.com",
        firstName: "Reader",
        status: "active",
        source: "article_gate",
        subscribedAt: new Date("2026-04-03T12:00:00.000Z"),
        lastSeenAt: null,
        createdAt: new Date("2026-04-03T12:00:00.000Z"),
        updatedAt: new Date("2026-04-03T12:00:00.000Z"),
      });

      beehiivMock.getBeehiivSubscriberStatus.mockResolvedValueOnce(null);

      const result = await findSubscriberByEmail("reader@example.com");

      expect(result).toBeNull();
    });

    it("returns null when subscriber is inactive in Beehiiv", async () => {
      prismaMock.prisma.subscriber.findUnique.mockResolvedValueOnce({
        id: 11n,
        email: "reader@example.com",
        firstName: "Reader",
        status: "active",
        source: "article_gate",
        subscribedAt: new Date("2026-04-03T12:00:00.000Z"),
        lastSeenAt: null,
        createdAt: new Date("2026-04-03T12:00:00.000Z"),
        updatedAt: new Date("2026-04-03T12:00:00.000Z"),
      });

      beehiivMock.getBeehiivSubscriberStatus.mockResolvedValueOnce({
        status: "inactive",
        id: "beehiiv-123",
      });

      const result = await findSubscriberByEmail("reader@example.com");

      expect(result).toBeNull();
    });
  });

  describe("findSubscriberByEmail with GHL as the provider", () => {
    it("trusts the local record without calling Beehiiv", async () => {
      vi.stubEnv("SUBSCRIBER_PROVIDER", "ghl");
      prismaMock.prisma.subscriber.findUnique.mockResolvedValueOnce({
        id: 12n,
        email: "reader@example.com",
        firstName: "Reader",
        status: "active",
        source: "article_gate",
        subscribedAt: new Date("2026-04-03T12:00:00.000Z"),
        lastSeenAt: null,
        createdAt: new Date("2026-04-03T12:00:00.000Z"),
        updatedAt: new Date("2026-04-03T12:00:00.000Z"),
      });

      const result = await findSubscriberByEmail("reader@example.com");

      expect(result).toMatchObject({
        id: 12,
        email: "reader@example.com",
        status: "active",
      });
      expect(beehiivMock.getBeehiivSubscriberStatus).not.toHaveBeenCalled();
    });
  });
});
