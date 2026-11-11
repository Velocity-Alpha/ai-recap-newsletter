import { describe, expect, it } from "vitest";

import { isReasoningEffort, modelFields, REASONING_EFFORTS } from "@/src/lib/reasoning-effort";

const DEFAULTS = { model: "gpt-6-luna", effort: "low" } as const;

describe("REASONING_EFFORTS", () => {
  it("lists the values gpt-6-luna accepts, lowest first", () => {
    expect(REASONING_EFFORTS).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
  });
});

describe("isReasoningEffort", () => {
  it("accepts a listed effort", () => {
    expect(isReasoningEffort("xhigh")).toBe(true);
  });

  it("refuses any other word", () => {
    expect(isReasoningEffort("minimal")).toBe(false);
  });
});

describe("modelFields", () => {
  it("sends the call site's model and effort when nothing overrides them", () => {
    expect(modelFields({}, DEFAULTS)).toEqual({ model: "gpt-6-luna", reasoning: { effort: "low" } });
  });

  it("sends the model and effort an eval gives", () => {
    expect(modelFields({ model: "gpt-6-sol", effort: "max" }, DEFAULTS)).toEqual({ model: "gpt-6-sol", reasoning: { effort: "max" } });
  });

  it("keeps the call site's effort when the override's effort is undefined", () => {
    expect(modelFields({ effort: undefined }, DEFAULTS)).toEqual({ model: "gpt-6-luna", reasoning: { effort: "low" } });
  });
});
