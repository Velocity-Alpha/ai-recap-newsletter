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
      baseline: null,
      repeats: 3,
      limit: null,
      concurrency: 24,
      judgeModel: "gpt-6.1-terra",
      judgeEffort: "medium",
      judgeTier: "flex",
      judgeConcurrency: 24,
      judgeRepeats: null,
    });
  });

  it("keeps the baseline, the call site's production effort", () => {
    expect(evalSettings({ model: "gpt-6-luna", efforts: ["low", "high"], baseline: "high" }, {}).baseline).toBe("high");
  });

  it("adds the baseline to a sweep without it, so every row has its comparison", () => {
    expect(evalSettings({ ...DEFAULTS, baseline: "medium" }, { EVAL_EFFORTS: "low,high" }).efforts).toEqual(["medium", "low", "high"]);
  });

  it("has no baseline for a call that takes no effort", () => {
    expect(evalSettings({ model: "m", efforts: null, baseline: "low" }, {}).baseline).toBeNull();
  });

  it("reads the judge's tier", () => {
    expect(evalSettings(DEFAULTS, { EVAL_JUDGE_TIER: "standard" }).judgeTier).toBe("standard");
  });

  it("rejects a tier that is not flex or standard", () => {
    expect(() => evalSettings(DEFAULTS, { EVAL_JUDGE_TIER: "batch" })).toThrow(/EVAL_JUDGE_TIER/);
  });

  it("reads EVAL_JUDGE_CONCURRENCY", () => {
    expect(evalSettings(DEFAULTS, { EVAL_JUDGE_CONCURRENCY: "6" }).judgeConcurrency).toBe(6);
  });

  it("reads the model from EVAL_MODEL", () => {
    expect(evalSettings(DEFAULTS, { EVAL_MODEL: "gpt-6-sol" }).model).toBe("gpt-6-sol");
  });

  it("reads the efforts from EVAL_EFFORTS, with `default` for the API default", () => {
    expect(evalSettings(DEFAULTS, { EVAL_EFFORTS: " none, default ,max" }).efforts).toEqual(["none", undefined, "max"]);
  });

  it("reads EVAL_REPEATS", () => {
    expect(evalSettings(DEFAULTS, { EVAL_REPEATS: "2" }).repeats).toBe(2);
  });

  it("reads EVAL_LIMIT", () => {
    expect(evalSettings(DEFAULTS, { EVAL_LIMIT: "5" }).limit).toBe(5);
  });

  it("reads EVAL_CONCURRENCY", () => {
    expect(evalSettings(DEFAULTS, { EVAL_CONCURRENCY: "8" }).concurrency).toBe(8);
  });

  it("reads the judge's model", () => {
    expect(evalSettings(DEFAULTS, { EVAL_JUDGE_MODEL: "gpt-6-luna" }).judgeModel).toBe("gpt-6-luna");
  });

  it("reads the judge's effort", () => {
    expect(evalSettings(DEFAULTS, { EVAL_JUDGE_EFFORT: "medium" }).judgeEffort).toBe("medium");
  });

  it("reads the judge's repeats", () => {
    expect(evalSettings(DEFAULTS, { EVAL_JUDGE_REPEATS: "1" }).judgeRepeats).toBe(1);
  });

  it("rejects an effort the API does not take", () => {
    expect(() => evalSettings(DEFAULTS, { EVAL_EFFORTS: "low,minimal" })).toThrow(/minimal/);
  });

  it("rejects a number below 1", () => {
    expect(() => evalSettings(DEFAULTS, { EVAL_REPEATS: "0" })).toThrow(/EVAL_REPEATS/);
  });

  it("rejects a value that is not a number", () => {
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
