import { unitVector as at } from "@/src/pipeline/repeats/__fixtures__/unit-vector";
import { describe, expect, it } from "vitest";
import { nearestStories } from "@/src/pipeline/repeats/nearest";


describe("nearestStories", () => {
  it("returns at most 5, highest first, and nothing under 0.55", () => {
    const pool = [10, 80, 20, 5, 30, 40, 50, 0].map((degrees, index) => ({ id: index + 1, vector: at(degrees) }));
    const result = nearestStories([1, 0], pool);
    expect(result.map((entry) => entry.id)).toEqual([8, 4, 1, 3, 5]);
    expect(result[0].similarity).toBeCloseTo(1);
    expect(result.every((entry) => entry.similarity >= 0.55)).toBe(true);
  });

  it("leaves out stories under the minimum", () => {
    // cos(57°) ≈ 0.545 and cos(56°) ≈ 0.559.
    const result = nearestStories([1, 0], [{ id: 1, vector: at(57) }, { id: 2, vector: at(56) }]);
    expect(result.map((entry) => entry.id)).toEqual([2]);
  });

  it("takes other limits", () => {
    const pool = [0, 10, 20].map((degrees, index) => ({ id: index + 1, vector: at(degrees) }));
    expect(nearestStories([1, 0], pool, { count: 2, minSimilarity: 0.99 }).map((entry) => entry.id)).toEqual([1]);
  });
});
