import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { submitSubscriberToBeehiiv } from "@/src/features/subscriber/beehiiv";

describe("subscriber Beehiiv client", () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    process.env.BEEHIIV_API_KEY = "beehiiv-key";
    process.env.BEEHIIV_PUBLICATION_ID = "pub_test";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("submits subscriptions without raw console logging", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
    });

    await submitSubscriberToBeehiiv({
      email: "reader@example.com",
      source: "homepage",
      path: "/",
      firstName: "Reader",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
