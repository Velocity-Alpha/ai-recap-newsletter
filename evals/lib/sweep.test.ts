import { describe, expect, it, vi } from "vitest";

import type { ResultsFile } from "@/evals/lib/results";
import { evalSettings } from "@/evals/lib/settings";
import { countGraded, countHits, runSweep, withSpread, type SweepSpec } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";

type Item = { id: number; answer: string };
const ITEMS: Item[] = [
  { id: 1, answer: "a" },
  { id: 2, answer: "b" },
  { id: 3, answer: "c" },
];

const noWrite = () => "x";

/** A sweep over ITEMS that returns each item's answer, writes nothing and scores nothing, unless changed. */
function toySweep<Grade = never>(changes: Partial<SweepSpec<Item, string, Grade>>) {
  return runSweep<Item, string, Grade>({
    task: "toy",
    title: "Toy",
    notes: [],
    settings: evalSettings({ model: "gpt-6-luna", efforts: ["low"] }, {}),
    items: ITEMS,
    id: (item) => String(item.id),
    run: async (item) => item.answer,
    score: () => [],
    write: noWrite,
    ...changes,
  });
}

describe("runSweep", () => {
  it("runs every item for each effort and repeat, capped by EVAL_LIMIT", async () => {
    const seen: string[] = [];
    await toySweep({
      settings: evalSettings({ model: "gpt-6-luna", efforts: ["low", "high"], repeats: 2 }, { EVAL_LIMIT: "2" }),
      async run(item, context) {
        seen.push(`${context.config.effort}:${item.id}:${context.repeat}`);
        return item.answer;
      },
    });
    expect(seen.sort()).toEqual(["high:1:0", "high:1:1", "high:2:0", "high:2:1", "low:1:0", "low:1:1", "low:2:0", "low:2:1"]);
  });

  it("gives one row per config, in sweep order", async () => {
    const result = await toySweep({ settings: evalSettings({ model: "gpt-6-luna", efforts: ["high", "low"] }, {}) });
    expect(result.rows.map((row) => [row.model, row.effort])).toEqual([
      ["gpt-6-luna", "high"],
      ["gpt-6-luna", "low"],
    ]);
  });

  it("counts a run that throws as an error and scores it as a miss", async () => {
    const result = await toySweep({
      async run(item) {
        if (item.id === 2) throw new Error("boom");
        return item.answer;
      },
      score: (outcomes) => [countHits("Right answer", outcomes, (outcome) => outcome.output === outcome.item.answer)],
    });
    expect(result.rows[0]).toMatchObject({ n: 3, errors: 1, metrics: [{ name: "Right answer", hits: 2, n: 3 }] });
  });

  it("adds each count's spread over the repeats", async () => {
    const result = await toySweep({
      settings: evalSettings({ model: "gpt-6-luna", efforts: ["low"], repeats: 2 }, {}),
      run: async (item, context) => (context.repeat === 0 ? item.answer : "wrong"),
      score: (outcomes) => [countHits("Right answer", outcomes, (outcome) => outcome.output === outcome.item.answer)],
    });
    expect(result.rows[0].metrics[0]).toEqual({ name: "Right answer", hits: 3, n: 6, spread: { min: 0, max: 1 } });
  });

  it("costs nothing and has no judge cost, grade count or shared cost when no call was made", async () => {
    const [row] = (await toySweep({})).rows;
    expect(row).toMatchObject({ costPerCallUsd: 0, judgeCostPerCallUsd: null });
    expect(row.graded).toBeUndefined();
    expect(row.sharedCostUsd).toBeUndefined();
  });

  it("writes the results file with the task, title, notes and columns", async () => {
    const write = vi.fn((file: ResultsFile) => `evals/results/${file.task}.md`);
    await toySweep({ notes: ["A toy eval."], columns: ["Right answer"], write });
    expect(write.mock.calls[0][0]).toMatchObject({ task: "toy", title: "Toy", notes: ["A toy eval."], columns: ["Right answer"] });
  });

  it("writes the raw JSON with the settings and each outcome's raw fields and error", async () => {
    const write = vi.fn((file: ResultsFile, raw: unknown) => {
      void raw;
      return `evals/results/${file.task}.md`;
    });
    await toySweep({
      settings: evalSettings({ model: "gpt-6-luna", efforts: ["low"] }, { EVAL_LIMIT: "2" }),
      async run(item) {
        if (item.id === 2) throw new Error("boom");
        return item.answer;
      },
      raw: (outcome) => ({ answer: outcome.output }),
      write,
    });
    const raw = write.mock.calls[0][1];
    expect(raw).toMatchObject({
      task: "toy",
      settings: { limit: 2 },
      configs: [{ effort: "low", outcomes: expect.arrayContaining([expect.objectContaining({ id: "1", answer: "a", gradeStatus: "none" })]) }],
    });
    expect(JSON.stringify(raw)).toContain("boom");
  });

  it("leaves grading out of the latency", async () => {
    const result = await toySweep<{ good: boolean }>({
      async grade() {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { good: true };
      },
    });
    expect(result.rows[0].latencyMs.p95).toBeLessThan(25);
  });

  it("grades only the first EVAL_JUDGE_REPEATS repeats and marks the rest skipped", async () => {
    const graded: string[] = [];
    const result = await toySweep<{ good: boolean }>({
      settings: evalSettings({ model: "gpt-6-luna", efforts: ["low"], repeats: 3 }, { EVAL_JUDGE_REPEATS: "2" }),
      items: ITEMS.slice(0, 2),
      async grade(item, _output, context) {
        graded.push(`${item.id}:${context.repeat}`);
        return { good: true };
      },
      score: (outcomes) => [{ name: "Skipped", value: outcomes.filter((outcome) => outcome.gradeStatus === "skipped").length }],
    });
    expect(graded.sort()).toEqual(["1:0", "1:1", "2:0", "2:1"]);
    expect(result.rows[0].metrics[0]).toMatchObject({ name: "Skipped", value: 2 });
  });

  it("counts a grade that throws as failed, and leaves it out of graded counts", async () => {
    const result = await toySweep<{ good: boolean }>({
      async grade(item, output) {
        if (item.id === 2) throw new Error("judge down");
        return { good: output === "a" };
      },
      score: (outcomes) => [countGraded("Good", outcomes, (outcome) => outcome.grade.good)],
    });
    expect(result.rows[0].graded).toEqual({ hits: 2, n: 3 });
    expect(result.rows[0].metrics[0]).toEqual({ name: "Good", hits: 1, n: 2 });
  });

  it("runs afterSweep with every config's outcomes and adds its metrics to each row", async () => {
    const result = await toySweep({
      settings: evalSettings({ model: "gpt-6-luna", efforts: ["high", "low"] }, {}),
      run: async (item, context) => `${item.answer}:${context.config.effort}`,
      async afterSweep(configs) {
        const low = configs.find((entry) => entry.config.effort === "low")!;
        return configs.map(({ outcomes }) => ({
          metrics: [{ name: "Same as low", hits: outcomes.filter((o, i) => o.output === low.outcomes[i].output).length, n: outcomes.length }],
        }));
      },
    });
    expect(result.rows.map((row) => row.metrics)).toEqual([[{ name: "Same as low", hits: 0, n: 3 }], [{ name: "Same as low", hits: 3, n: 3 }]]);
  });

  it("does each piece of shared work once across configs", async () => {
    const work = vi.fn(async () => "read");
    await toySweep({
      settings: evalSettings({ model: "gpt-6-luna", efforts: ["high", "low"] }, {}),
      grade: async (item, _output, context) => context.shared(`read:${item.id}`, work),
    });
    expect(work).toHaveBeenCalledTimes(3);
  });

  it("shows the effort as n/a for a call that takes no effort", async () => {
    const result = await toySweep({ settings: evalSettings({ model: "gpt-6-luna", efforts: null }, {}) });
    expect(result.rows.map((row) => row.effort)).toEqual(["n/a"]);
  });
});

describe("withSpread", () => {
  const perRepeat = [
    [{ name: "Hit", hits: 1, n: 3 }, { name: "Mean", value: 1 }, { name: "Once", value: 1 }],
    [{ name: "Hit", hits: 2, n: 3 }, { name: "Mean", value: 3 }],
    [{ name: "Hit", hits: 0, n: 0 }, { name: "Mean", value: 99 }],
  ];

  it("adds the lowest and highest repeat of a count, skipping a repeat with nothing counted", () => {
    expect(withSpread([{ name: "Hit", hits: 3, n: 6 }], perRepeat, 3)).toEqual([{ name: "Hit", hits: 3, n: 6, spread: { min: 1 / 3, max: 2 / 3 } }]);
  });

  it("takes a number's spread only from the first given repeats", () => {
    expect(withSpread([{ name: "Mean", value: 2 }], perRepeat, 2)).toEqual([{ name: "Mean", value: 2, spread: { min: 1, max: 3 } }]);
  });

  it("adds no spread to a number found in only one repeat", () => {
    expect(withSpread([{ name: "Once", value: 1 }], perRepeat, 2)).toEqual([{ name: "Once", value: 1 }]);
  });
});

describe("countHits", () => {
  it("counts errors as misses", () => {
    const outcomes = [outcomeOf({ item: 1, output: "x" }), outcomeOf<number, string>({ item: 2, error: "failed" })];
    expect(countHits("Got x", outcomes, (outcome) => outcome.output === "x")).toEqual({ name: "Got x", hits: 1, n: 2 });
  });
});
