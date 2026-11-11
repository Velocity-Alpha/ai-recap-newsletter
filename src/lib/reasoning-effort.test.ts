import { describe, expect, it } from "vitest";

import { API_DEFAULT_EFFORT, REASONING_EFFORTS, effortOrDefault, isReasoningEffort, reasoningField } from "@/src/lib/reasoning-effort";

describe("reasoning effort", () => {
  it("lists the values gpt-6-luna accepts, lowest first", () => {
    expect(REASONING_EFFORTS).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(isReasoningEffort("xhigh")).toBe(true);
    expect(isReasoningEffort("minimal")).toBe(false);
  });

  it("sends a reasoning field only for a set effort", () => {
    expect(reasoningField("high")).toEqual({ reasoning: { effort: "high" } });
    expect(reasoningField(API_DEFAULT_EFFORT)).toEqual({});
  });

  it("takes an override, where a present but undefined effort means the API default", () => {
    expect(effortOrDefault({}, "low")).toBe("low");
    expect(effortOrDefault({ effort: "max" }, "low")).toBe("max");
    expect(effortOrDefault({ effort: undefined }, "low")).toBeUndefined();
  });
});
