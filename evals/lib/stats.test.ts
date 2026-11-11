import { describe, expect, it } from "vitest";

import { mapLimit, percentile } from "@/evals/lib/stats";

describe("percentile", () => {
  it("takes the nearest rank", () => {
    const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
    expect(percentile([42], 95)).toBe(42);
  });

  it("is null for no values", () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe("mapLimit", () => {
  it("keeps the order and never runs more than the limit at once", async () => {
    let running = 0;
    let most = 0;
    const result = await mapLimit([30, 10, 20, 5, 15], 2, async (wait, index) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, wait));
      running -= 1;
      return index * 10;
    });
    expect(result).toEqual([0, 10, 20, 30, 40]);
    expect(most).toBe(2);
  });
});
