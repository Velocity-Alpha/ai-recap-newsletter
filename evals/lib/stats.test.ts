import { describe, expect, it } from "vitest";

import { mean, pairedBootstrap, percentile } from "@/evals/lib/stats";

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

describe("pairedBootstrap", () => {
  const count = (hits: number, n = 1) => ({ hits, n });

  it("gives the difference in share of the other config against the baseline", () => {
    const result = pairedBootstrap([
      { baseline: count(0), other: count(1) },
      { baseline: count(1), other: count(1) },
    ]);
    expect(result?.diff).toBeCloseTo(0.5, 10);
  });

  it("gives an interval of zero width when every item moves the same way", () => {
    const pairs = Array.from({ length: 10 }, () => ({ baseline: count(0, 2), other: count(1, 2) }));
    expect(pairedBootstrap(pairs)).toEqual({ diff: 0.5, low: 0.5, high: 0.5 });
  });

  it("brackets the difference with its interval", () => {
    const pairs = Array.from({ length: 20 }, (_, index) => ({ baseline: count(index % 3 === 0 ? 1 : 0), other: count(index % 2) }));
    const result = pairedBootstrap(pairs)!;
    expect(result.low).toBeLessThanOrEqual(result.diff);
    expect(result.high).toBeGreaterThanOrEqual(result.diff);
    expect(result.high - result.low).toBeGreaterThan(0);
  });

  it("resamples items, so items that move together widen the interval less than items that differ", () => {
    const same = Array.from({ length: 20 }, () => ({ baseline: count(1, 2), other: count(2, 2) }));
    const mixed = Array.from({ length: 20 }, (_, index) => ({ baseline: count(index % 2 ? 2 : 0, 2), other: count(index % 2 ? 2 : 2, 2) }));
    const width = (pairs: typeof same) => {
      const result = pairedBootstrap(pairs)!;
      return result.high - result.low;
    };
    expect(width(same)).toBe(0);
    expect(width(mixed)).toBeGreaterThan(0);
  });

  it("gives the same interval every time (fixed seed)", () => {
    const pairs = Array.from({ length: 15 }, (_, index) => ({ baseline: count(index % 2), other: count(index % 3 === 0 ? 0 : 1) }));
    expect(pairedBootstrap(pairs)).toEqual(pairedBootstrap(pairs));
  });

  it("is null when either side counted nothing", () => {
    expect(pairedBootstrap([{ baseline: count(0, 0), other: count(1) }])).toBeNull();
    expect(pairedBootstrap([])).toBeNull();
  });
});
