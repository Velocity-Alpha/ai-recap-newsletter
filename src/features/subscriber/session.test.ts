import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSubscriberSessionToken,
  verifySubscriberSessionToken,
} from "@/src/features/subscriber/server";

describe("subscriber session token", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies a valid signed token", () => {
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

  it("rejects a token with an invalid signature", () => {
    const token = createSubscriberSessionToken({
      subscriberId: 42,
      email: "reader@example.com",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    const [payload] = token.split(".");
    expect(verifySubscriberSessionToken(`${payload}.invalid-signature`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = createSubscriberSessionToken({
      subscriberId: 42,
      email: "reader@example.com",
      issuedAt: Date.now() - 120_000,
      expiresAt: Date.now() - 60_000,
    });

    expect(verifySubscriberSessionToken(token)).toBeNull();
  });
});
