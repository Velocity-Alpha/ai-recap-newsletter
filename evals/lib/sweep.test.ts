import { describe, expect, it, vi } from "vitest";

import type { ResultsFile } from "@/evals/lib/results";
import { evalSettings } from "@/evals/lib/settings";
import { countGraded, countHits, runSweep, withSpread } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";

type Item = { id: number; answer: string };
const ITEMS: Item[] = [
  { id: 1, answer: "a" },
  { id: 2, answer: "b" },
  { id: 3, answer: "c" },
];

const noWrite = () => "x";

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
      columns: ["Right answer"],
      raw: (outcome) => ({ answer: outcome.output }),
      write,
    });

    expect(seen.sort()).toEqual(["high:1:0", "high:1:1", "high:2:0", "high:2:1", "low:1:0", "low:1:1", "low:2:0", "low:2:1"]);
    expect(result.rows.map((row) => [row.effort, row.n, row.errors, row.metrics])).toEqual([
      ["low", 4, 0, [{ name: "Right answer", hits: 4, n: 4, spread: { min: 1, max: 1 } }]],
      ["high", 4, 2, [{ name: "Right answer", hits: 2, n: 4, spread: { min: 0.5, max: 0.5 } }]],
    ]);
    // No calls were recorded, so the cost is zero, there was no judge and no grade step.
    expect(result.rows[0]).toMatchObject({ costPerCallUsd: 0, judgeCostPerCallUsd: null, model: "gpt-6-luna" });
    expect(result.rows[0].graded).toBeUndefined();
    expect(result.rows[0].sharedCostUsd).toBeUndefined();
    expect(result.rows[0].latencyMs.p50).not.toBeNull();

    const [file, raw] = write.mock.calls[0];
    expect(file).toMatchObject({ task: "toy", title: "Toy", notes: ["A toy eval."], columns: ["Right answer"] });
    expect(raw).toMatchObject({
      task: "toy",
      settings: { repeats: 2, limit: 2 },
      configs: [
        { effort: "low", outcomes: expect.arrayContaining([expect.objectContaining({ id: "1", answer: "a", gradeStatus: "none" })]) },
        {},
      ],
    });
    expect(JSON.stringify(raw)).toContain("boom");
  });

  it("times only the run, grades the first EVAL_JUDGE_REPEATS repeats, and counts failed grades", async () => {
    const settings = evalSettings({ model: "gpt-6-luna", efforts: ["low"], repeats: 3 }, { EVAL_JUDGE_REPEATS: "2" });
    const graded: string[] = [];
    const result = await runSweep({
      task: "toy",
      title: "Toy",
      notes: [],
      settings,
      items: ITEMS.slice(0, 2),
      id: (item) => String(item.id),
      run: async (item) => item.answer,
      async grade(item, output, context) {
        graded.push(`${item.id}:${context.repeat}`);
        if (item.id === 2 && context.repeat === 1) throw new Error("judge down");
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { good: output === "a" };
      },
      score: (outcomes) => [
        countGraded("Good", outcomes, (outcome) => outcome.grade.good),
        { name: "Skipped", value: outcomes.filter((outcome) => outcome.gradeStatus === "skipped").length },
      ],
      write: noWrite,
    });
    expect(graded.sort()).toEqual(["1:0", "1:1", "2:0", "2:1"]);
    const [row] = result.rows;
    expect(row.graded).toEqual({ hits: 3, n: 4 });
    expect(row.metrics[0]).toEqual({ name: "Good", hits: 2, n: 3, spread: { min: 0.5, max: 1 } });
    expect(row.metrics[1]).toMatchObject({ name: "Skipped", value: 2 });
    // The 30 ms of grading are not in the latency.
    expect(row.latencyMs.p95).toBeLessThan(25);
  });

  it("runs afterSweep with every config's outcomes, adds its metrics, and does shared work once", async () => {
    const settings = evalSettings({ model: "gpt-6-luna", efforts: ["high", "low"] }, {});
    const work = vi.fn(async () => "read");
    const result = await runSweep({
      task: "toy",
      title: "Toy",
      notes: [],
      settings,
      items: ITEMS,
      id: (item) => String(item.id),
      run: async (item, context) => `${item.answer}:${context.config.effort}`,
      grade: async (item, _output, context) => context.shared(`read:${item.id}`, work),
      async afterSweep(configs) {
        const low = configs.find((entry) => entry.config.effort === "low")!;
        return configs.map(({ outcomes }) => ({
          metrics: [{ name: "Same as low", hits: outcomes.filter((o, i) => o.output === low.outcomes[i].output).length, n: outcomes.length }],
        }));
      },
      score: () => [],
      write: noWrite,
    });
    expect(work).toHaveBeenCalledTimes(3);
    expect(result.rows.map((row) => row.metrics)).toEqual([[{ name: "Same as low", hits: 0, n: 3 }], [{ name: "Same as low", hits: 3, n: 3 }]]);
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
      write: noWrite,
    });
    expect(result.rows.map((row) => row.effort)).toEqual(["n/a"]);
  });
});

describe("withSpread", () => {
  it("adds the lowest and highest repeat, skips empty counts, and takes numbers only from the given repeats", () => {
    const total = [
      { name: "Hit", hits: 3, n: 6 },
      { name: "Mean", value: 2 },
      { name: "Once", value: 1 },
    ];
    const perRepeat = [
      [{ name: "Hit", hits: 1, n: 3 }, { name: "Mean", value: 1 }, { name: "Once", value: 1 }],
      [{ name: "Hit", hits: 2, n: 3 }, { name: "Mean", value: 3 }],
      [{ name: "Hit", hits: 0, n: 0 }, { name: "Mean", value: 99 }],
    ];
    expect(withSpread(total, perRepeat, 2)).toEqual([
      { name: "Hit", hits: 3, n: 6, spread: { min: 1 / 3, max: 2 / 3 } },
      { name: "Mean", value: 2, spread: { min: 1, max: 3 } },
      { name: "Once", value: 1 },
    ]);
  });
});

describe("countHits", () => {
  it("counts errors as misses", () => {
    const outcomes = [outcomeOf({ item: 1, output: "x" }), outcomeOf<number, string>({ item: 2, error: "failed" })];
    expect(countHits("Got x", outcomes, (outcome) => outcome.output === "x")).toEqual({ name: "Got x", hits: 1, n: 2 });
  });
});
