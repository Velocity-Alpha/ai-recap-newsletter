import { beforeEach, describe, expect, it, vi } from "vitest";

const readSetting = vi.hoisted(() => vi.fn());
vi.mock("@/src/pipeline/settings", () => ({ readSetting }));

import { DEFAULT_REASON_CODES, readReasonCodes, REASON_CODES_SETTING } from "@/src/pipeline/feedback/reason-codes";

beforeEach(() => {
  readSetting.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("readReasonCodes", () => {
  it("has the starting codes as the default", () => {
    expect(DEFAULT_REASON_CODES).toEqual({
      exclude: ["repeat", "not news", "too niche", "weak source", "promo", "low quality"],
      lead: ["bigger story", "more reach", "less doom"],
      move: ["wrong section"],
    });
  });

  it("uses the default when the setting row is missing", async () => {
    readSetting.mockResolvedValueOnce(null);
    await expect(readReasonCodes()).resolves.toEqual(DEFAULT_REASON_CODES);
    expect(readSetting).toHaveBeenCalledWith(REASON_CODES_SETTING);
    expect(REASON_CODES_SETTING).toBe("feedback.reason_codes");
  });

  it("uses the setting, and the default for each key that is not a list of strings", async () => {
    readSetting.mockResolvedValueOnce({ exclude: ["repeat", "off topic"], lead: "bigger story", move: ["x", 3] });
    await expect(readReasonCodes()).resolves.toEqual({
      exclude: ["repeat", "off topic"],
      lead: DEFAULT_REASON_CODES.lead,
      move: DEFAULT_REASON_CODES.move,
    });
  });

  it("uses the default when the setting is not an object, or cannot be read", async () => {
    readSetting.mockResolvedValueOnce(["repeat"]);
    await expect(readReasonCodes()).resolves.toEqual(DEFAULT_REASON_CODES);
    readSetting.mockRejectedValueOnce(new Error("database down"));
    await expect(readReasonCodes()).resolves.toEqual(DEFAULT_REASON_CODES);
  });

  it("allows an empty list: no chips for that action", async () => {
    readSetting.mockResolvedValueOnce({ exclude: [], lead: ["more reach"], move: [] });
    await expect(readReasonCodes()).resolves.toEqual({ exclude: [], lead: ["more reach"], move: [] });
  });
});
