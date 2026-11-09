import { describe, expect, it, vi } from "vitest";

import { withRetries } from "@/src/pipeline/draft/image/retry";

describe("withRetries", () => {
  it("returns the first success", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(new Error("flaky")).mockResolvedValueOnce("ok");
    await expect(withRetries("Step", attempt, { retries: 2, delayMs: 0 })).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("makes retries + 1 attempts, then names the step and the last error", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(new Error("first")).mockRejectedValue(new Error("last"));
    await expect(withRetries("Step", attempt, { retries: 2, delayMs: 0 })).rejects.toThrow(
      "Step failed after 3 attempts: last",
    );
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("waits between attempts", async () => {
    vi.useFakeTimers();
    try {
      const attempt = vi.fn().mockRejectedValueOnce(new Error("flaky")).mockResolvedValueOnce("ok");
      const result = withRetries("Step", attempt, { retries: 1, delayMs: 5_000 });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(attempt).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
