import { describe, expect, it } from "vitest";

import { createLimit, mapLimit } from "@/evals/lib/concurrency";

describe("mapLimit", () => {
  async function run(limit: number) {
    let running = 0;
    let most = 0;
    const result = await mapLimit([30, 10, 20, 5, 15], limit, async (wait, index) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, wait));
      running -= 1;
      return index * 10;
    });
    return { result, most };
  }

  it("keeps the items' order, though later items finish first", async () => {
    expect((await run(2)).result).toEqual([0, 10, 20, 30, 40]);
  });

  it("never runs more than the limit at once", async () => {
    expect((await run(2)).most).toBe(2);
  });
});

describe("createLimit", () => {
  it("never runs more than the limit at once, and returns each result", async () => {
    const limit = createLimit(2);
    let running = 0;
    let most = 0;
    const results = await Promise.all(
      [20, 5, 10, 1].map((wait) =>
        limit(async () => {
          running += 1;
          most = Math.max(most, running);
          await new Promise((resolve) => setTimeout(resolve, wait));
          running -= 1;
          return wait;
        })
      )
    );
    expect(results).toEqual([20, 5, 10, 1]);
    expect(most).toBe(2);
  });

  it("frees the slot of work that throws", async () => {
    const limit = createLimit(1);
    await expect(limit(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limit(async () => "next")).resolves.toBe("next");
  });
});
