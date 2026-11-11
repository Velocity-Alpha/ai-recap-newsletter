import { describe, expect, it } from "vitest";

import { effortLabel, evalSettings, sweepConfigs } from "@/evals/lib/settings";

describe("evalSettings", () => {
  it("uses the eval's own defaults when nothing is set", () => {
    const settings = evalSettings({ model: "gpt-6-luna", efforts: ["low", "high"], repeats: 3 }, {});
    expect(settings).toEqual({
      model: "gpt-6-luna",
      efforts: ["low", "high"],
      effortApplies: true,
      repeats: 3,
      limit: null,
      concurrency: 4,
      judgeModel: "gpt-6-sol",
      judgeEffort: "high",
      judgeRepeats: null,
    });
  });

  it("reads EVAL_MODEL, EVAL_EFFORTS, EVAL_REPEATS, EVAL_LIMIT, EVAL_CONCURRENCY and the judge", () => {
    const settings = evalSettings(
      { model: "gpt-6-luna", efforts: ["low"] },
      {
        EVAL_MODEL: "gpt-6-sol",
        EVAL_EFFORTS: " none, default ,max",
        EVAL_REPEATS: "2",
        EVAL_LIMIT: "5",
        EVAL_CONCURRENCY: "8",
        EVAL_JUDGE_MODEL: "gpt-6-luna",
        EVAL_JUDGE_EFFORT: "medium",
        EVAL_JUDGE_REPEATS: "1",
      }
    );
    expect(settings).toMatchObject({
      model: "gpt-6-sol",
      efforts: ["none", undefined, "max"],
      repeats: 2,
      limit: 5,
      concurrency: 8,
      judgeModel: "gpt-6-luna",
      judgeEffort: "medium",
      judgeRepeats: 1,
    });
  });

  it("rejects an effort the API does not take, and a bad number", () => {
    expect(() => evalSettings({ model: "m", efforts: ["low"] }, { EVAL_EFFORTS: "low,minimal" })).toThrow(/minimal/);
    expect(() => evalSettings({ model: "m", efforts: ["low"] }, { EVAL_REPEATS: "0" })).toThrow(/EVAL_REPEATS/);
    expect(() => evalSettings({ model: "m", efforts: ["low"] }, { EVAL_LIMIT: "x" })).toThrow(/EVAL_LIMIT/);
  });

  it("refuses EVAL_EFFORTS for a task that takes no effort, and sweeps the model alone", () => {
    expect(() => evalSettings({ model: "m", efforts: null }, { EVAL_EFFORTS: "low" })).toThrow(/takes no effort/);
    const settings = evalSettings({ model: "m", efforts: null }, {});
    expect(settings.effortApplies).toBe(false);
    expect(sweepConfigs(settings)).toEqual([{ model: "m", effort: undefined }]);
  });
});

describe("sweepConfigs", () => {
  it("gives one config per effort, in the order given", () => {
    const settings = evalSettings({ model: "gpt-6-luna", efforts: ["none", undefined, "high"] }, {});
    expect(sweepConfigs(settings)).toEqual([
      { model: "gpt-6-luna", effort: "none" },
      { model: "gpt-6-luna", effort: undefined },
      { model: "gpt-6-luna", effort: "high" },
    ]);
  });

  it("names the API default plainly", () => {
    expect(effortLabel(undefined)).toBe("api default");
    expect(effortLabel("low")).toBe("low");
  });
});
