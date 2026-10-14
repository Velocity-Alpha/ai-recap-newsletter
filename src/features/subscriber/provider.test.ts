import { afterEach, describe, expect, it, vi } from "vitest";

import { getSubscriberProvider } from "@/src/features/subscriber/provider";

describe("subscriber provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to Beehiiv when SUBSCRIBER_PROVIDER is unset", () => {
    vi.stubEnv("SUBSCRIBER_PROVIDER", "");

    expect(getSubscriberProvider()).toBe("beehiiv");
  });

  it("returns ghl when configured", () => {
    vi.stubEnv("SUBSCRIBER_PROVIDER", "ghl");

    expect(getSubscriberProvider()).toBe("ghl");
  });

  it("normalizes whitespace and casing", () => {
    vi.stubEnv("SUBSCRIBER_PROVIDER", " Beehiiv ");

    expect(getSubscriberProvider()).toBe("beehiiv");
  });

  it("throws a not-configured error for unknown values", () => {
    vi.stubEnv("SUBSCRIBER_PROVIDER", "gh1");

    expect(() => getSubscriberProvider()).toThrow(
      'SUBSCRIBER_PROVIDER "gh1" is not configured. Use "beehiiv" or "ghl".',
    );
  });
});
