import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  requestSubscriberSignInCode,
  subscribeAndUpsertSubscriber,
  unsubscribeSubscriber,
  unsubscribeSubscriberByToken,
  unsubscribeSubscriberFromWebhook,
  verifySubscriberSignInCode,
} from "@/src/features/subscriber/service";

const serverFns = vi.hoisted(() => ({
  cleanupExpiredOneTimeCodes: vi.fn(),
  consumeOneTimeCode: vi.fn(),
  createOneTimeCode: vi.fn(),
  deleteOneTimeCode: vi.fn(),
  findSubscriberByEmail: vi.fn(),
  isValidSubscriberEmail: vi.fn(),
  markSubscriberUnsubscribed: vi.fn(),
  normalizeSubscriberEmail: vi.fn(),
  storeOneTimeCode: vi.fn(),
  touchSubscriberSeenAt: vi.fn(),
  upsertSubscriber: vi.fn(),
  verifySubscriberUnsubscribeToken: vi.fn(),
}));

const ghlFns = vi.hoisted(() => ({
  submitSubscriberToGhl: vi.fn(),
}));

const emailFns = vi.hoisted(() => ({
  sendSubscriberOtpEmail: vi.fn(),
}));

vi.mock("@/src/features/subscriber/server", () => serverFns);
vi.mock("@/src/features/subscriber/ghl", () => ghlFns);
vi.mock("@/src/features/subscriber/email", () => emailFns);

describe("subscriber service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverFns.isValidSubscriberEmail.mockReturnValue(true);
    serverFns.normalizeSubscriberEmail.mockImplementation((email: string) => email.trim().toLowerCase());
    serverFns.createOneTimeCode.mockReturnValue("123456");
  });

  it("treats an active subscriber as an idempotent subscribe success", async () => {
    const existingSubscriber = {
      id: 1,
      email: "reader@example.com",
      firstName: null,
      status: "active",
      source: "article_gate",
      subscribedAt: "2026-04-03T12:00:00.000Z",
      lastSeenAt: null,
      createdAt: "2026-04-03T12:00:00.000Z",
      updatedAt: "2026-04-03T12:00:00.000Z",
    };
    serverFns.findSubscriberByEmail.mockResolvedValue(existingSubscriber);

    await expect(
      subscribeAndUpsertSubscriber({
        firstName: "Reader",
        email: "Reader@example.com",
        source: "article_gate",
        path: "/issue/test",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "already_subscribed",
    });
    expect(ghlFns.submitSubscriberToGhl).not.toHaveBeenCalled();
    expect(serverFns.touchSubscriberSeenAt).not.toHaveBeenCalled();
  });

  it("subscribes a new reader through GHL before creating local access", async () => {
    serverFns.findSubscriberByEmail.mockResolvedValue(null);
    serverFns.upsertSubscriber.mockResolvedValue({ id: 2, email: "reader@example.com", firstName: "Reader", status: "active" });

    const result = await subscribeAndUpsertSubscriber({
      firstName: "Reader",
      email: "reader@example.com",
      source: "article_gate",
      path: "/issue/test",
    });

    expect(ghlFns.submitSubscriberToGhl).toHaveBeenCalledWith({
      firstName: "Reader",
      email: "reader@example.com",
      source: "article_gate",
      path: "/issue/test",
    });
    expect(serverFns.upsertSubscriber).toHaveBeenCalledWith({
      email: "reader@example.com",
      firstName: "Reader",
      source: "article_gate",
      status: "active",
    });
    expect(result.newlySubscribed).toBe(true);
  });

  it("rejects OTP requests for unknown subscribers", async () => {
    serverFns.findSubscriberByEmail.mockResolvedValue(null);

    await expect(
      requestSubscriberSignInCode({
        email: "reader@example.com",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(emailFns.sendSubscriberOtpEmail).not.toHaveBeenCalled();
  });

  it("rejects OTP requests for unsubscribed subscribers with a specific code", async () => {
    serverFns.findSubscriberByEmail.mockResolvedValue({
      id: 6,
      email: "reader@example.com",
      firstName: "Reader",
      status: "unsubscribed",
    });

    await expect(
      requestSubscriberSignInCode({
        email: "reader@example.com",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "unsubscribed",
      message: "You unsubscribed from emails. Resubscribe to restore access.",
    });
    expect(emailFns.sendSubscriberOtpEmail).not.toHaveBeenCalled();
  });

  it("rejects invalid or expired OTP codes", async () => {
    serverFns.findSubscriberByEmail.mockResolvedValue({
      id: 5,
      email: "reader@example.com",
      firstName: "Reader",
      status: "active",
    });
    serverFns.consumeOneTimeCode.mockResolvedValue(false);

    await expect(
      verifySubscriberSignInCode({
        email: "reader@example.com",
        code: "123456",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("marks a subscriber inactive from an unsubscribe webhook", async () => {
    serverFns.findSubscriberByEmail.mockResolvedValue({
      id: 9,
      email: "reader@example.com",
      firstName: "Reader",
      status: "active",
    });
    serverFns.markSubscriberUnsubscribed.mockResolvedValue({
      id: 9,
      email: "reader@example.com",
      firstName: "Reader",
      status: "unsubscribed",
    });

    await unsubscribeSubscriber({
      email: "reader@example.com",
    });

    expect(serverFns.markSubscriberUnsubscribed).toHaveBeenCalledWith({
      email: "reader@example.com",
    });
  });

  it("ignores unsubscribe tokens that are missing or invalid", async () => {
    serverFns.verifySubscriberUnsubscribeToken.mockReturnValue(null);

    await expect(unsubscribeSubscriberByToken({ token: "bad-token" })).resolves.toBeNull();
    expect(serverFns.markSubscriberUnsubscribed).not.toHaveBeenCalled();
  });

  it("marks a subscriber inactive from a signed unsubscribe token", async () => {
    serverFns.verifySubscriberUnsubscribeToken.mockReturnValue({
      purpose: "unsubscribe",
      email: "reader@example.com",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    serverFns.markSubscriberUnsubscribed.mockResolvedValue({
      id: 10,
      email: "reader@example.com",
      firstName: "Reader",
      status: "unsubscribed",
    });

    await unsubscribeSubscriberByToken({
      token: "signed-token",
    });

    expect(serverFns.markSubscriberUnsubscribed).toHaveBeenCalledWith({
      email: "reader@example.com",
    });
  });

  it("allows the webhook flow to be idempotent when the subscriber is missing", async () => {
    serverFns.markSubscriberUnsubscribed.mockResolvedValue(null);

    await expect(
      unsubscribeSubscriberFromWebhook({
        email: "reader@example.com",
      }),
    ).resolves.toBeNull();
    expect(serverFns.markSubscriberUnsubscribed).toHaveBeenCalledWith({
      email: "reader@example.com",
    });
  });
});
