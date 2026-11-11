import { describe, expect, it, vi } from "vitest";

import { evalSettings } from "@/evals/lib/settings";
import { countHits, runSweep, type Outcome } from "@/evals/lib/sweep";
import type { ResultsFile } from "@/evals/lib/results";

type Item = { id: number; answer: string };
const ITEMS: Item[] = [
  { id: 1, answer: "a" },
  { id: 2, answer: "b" },
  { id: 3, answer: "c" },
];

describe("runSweep", () => {
  it("runs every item for each effort and repeat, scores each config, and writes one row per config", async () => {
    const write = vi.fn((file: ResultsFile, raw: unknown) => {
      void raw;
      return `evals/results/${file.task}.md`;
    });
    const seen: string[] = [];
    const settings = evalSettings({ model: "gpt-6-luna", efforts: ["low", "high"], repeats: 2 }, { EVAL_LIMIT: "2" });

    const result = await runSweep({
      task: "toy",
      title: "Toy",
      notes: ["A toy eval."],
      settings,
      items: ITEMS,
      id: (item) => String(item.id),
      async run(item, context) {
        seen.push(`${context.config.effort}:${item.id}:${context.repeat}`);
        if (context.config.effort === "high" && item.id === 2) throw new Error("boom");
        return item.answer;
      },
      score: (outcomes) => [countHits("Right answer", outcomes, (outcome) => outcome.output === outcome.item.answer)],
      raw: (outcome) => ({ answer: outcome.output }),
      write,
    });

    expect(seen.sort()).toEqual(["high:1:0", "high:1:1", "high:2:0", "high:2:1", "low:1:0", "low:1:1", "low:2:0", "low:2:1"]);
    expect(result.rows.map((row) => [row.effort, row.n, row.errors, row.metrics])).toEqual([
      ["low", 4, 0, [{ name: "Right answer", hits: 4, n: 4 }]],
      ["high", 4, 2, [{ name: "Right answer", hits: 2, n: 4 }]],
    ]);
    // No calls were recorded, so the cost is zero, and there was no judge.
    expect(result.rows[0]).toMatchObject({ costPerCallUsd: 0, judgeCostPerCallUsd: null, model: "gpt-6-luna" });
    expect(result.rows[0].latencyMs.p50).not.toBeNull();

    const [file, raw] = write.mock.calls[0];
    expect(file).toMatchObject({ task: "toy", title: "Toy", notes: ["A toy eval."] });
    expect(raw).toMatchObject({
      task: "toy",
      settings: { repeats: 2, limit: 2 },
      configs: [{ effort: "low", outcomes: expect.arrayContaining([expect.objectContaining({ id: "1", answer: "a" })]) }, {}],
    });
    expect(JSON.stringify(raw)).toContain("boom");
  });

  it("shows the effort as n/a for a call that takes no effort", async () => {
    const settings = evalSettings({ model: "gpt-6-luna", efforts: null }, {});
    const result = await runSweep({
      task: "toy",
      title: "Toy",
      notes: [],
      settings,
      items: ITEMS,
      id: (item) => String(item.id),
      run: async (item) => item.answer,
      score: () => [],
      write: () => "x",
    });
    expect(result.rows.map((row) => row.effort)).toEqual(["n/a"]);
  });
});

describe("countHits", () => {
  it("counts errors as misses", () => {
    const outcomes = [
      { output: "x", error: null },
      { output: null, error: "failed" },
    ] as Outcome<unknown, string>[];
    expect(countHits("Got x", outcomes, (outcome) => outcome.output === "x")).toEqual({ name: "Got x", hits: 1, n: 2 });
  });
});
