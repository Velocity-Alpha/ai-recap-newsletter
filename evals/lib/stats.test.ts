import { describe, expect, it } from "vitest";

import { mean, percentile } from "@/evals/lib/stats";

describe("percentile", () => {
  it("takes the nearest rank", () => {
    const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
  });

  it("is the value itself for one value", () => {
    expect(percentile([42], 95)).toBe(42);
  });

  it("is null for no values", () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe("mean", () => {
  it("averages the values", () => {
    expect(mean([1, 2, 6])).toBe(3);
  });

  it("is 0 for no values", () => {
    expect(mean([])).toBe(0);
  });
});
