import { describe, expect, it } from "vitest";

import { effortLabel, evalSettings, sweepConfigs } from "@/evals/lib/settings";

const DEFAULTS = { model: "gpt-6-luna", efforts: ["low" as const] };

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

  it("reads the model from EVAL_MODEL", () => {
    expect(evalSettings(DEFAULTS, { EVAL_MODEL: "gpt-6-sol" }).model).toBe("gpt-6-sol");
  });

  it("reads the efforts from EVAL_EFFORTS, with `default` for the API default", () => {
    expect(evalSettings(DEFAULTS, { EVAL_EFFORTS: " none, default ,max" }).efforts).toEqual(["none", undefined, "max"]);
  });

  it("reads EVAL_REPEATS, EVAL_LIMIT and EVAL_CONCURRENCY", () => {
    expect(evalSettings(DEFAULTS, { EVAL_REPEATS: "2", EVAL_LIMIT: "5", EVAL_CONCURRENCY: "8" })).toMatchObject({
      repeats: 2,
      limit: 5,
      concurrency: 8,
    });
  });

  it("reads the judge's model, effort and repeats", () => {
    const env = { EVAL_JUDGE_MODEL: "gpt-6-luna", EVAL_JUDGE_EFFORT: "medium", EVAL_JUDGE_REPEATS: "1" };
    expect(evalSettings(DEFAULTS, env)).toMatchObject({ judgeModel: "gpt-6-luna", judgeEffort: "medium", judgeRepeats: 1 });
  });

  it("rejects an effort the API does not take", () => {
    expect(() => evalSettings(DEFAULTS, { EVAL_EFFORTS: "low,minimal" })).toThrow(/minimal/);
  });

  it("rejects a number below 1 or not a number", () => {
    expect(() => evalSettings(DEFAULTS, { EVAL_REPEATS: "0" })).toThrow(/EVAL_REPEATS/);
    expect(() => evalSettings(DEFAULTS, { EVAL_LIMIT: "x" })).toThrow(/EVAL_LIMIT/);
  });

  it("refuses EVAL_EFFORTS for a call that takes no effort", () => {
    expect(() => evalSettings({ model: "m", efforts: null }, { EVAL_EFFORTS: "low" })).toThrow(/takes no effort/);
  });

  it("sweeps the model alone for a call that takes no effort", () => {
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
});

describe("effortLabel", () => {
  it("names the API default plainly", () => {
    expect(effortLabel(undefined)).toBe("api default");
  });

  it("names a set effort by its own word", () => {
    expect(effortLabel("low")).toBe("low");
  });
});
