import { describe, expect, it } from "vitest";

import { safeEqual } from "@/src/server/safe-compare";

describe("safeEqual", () => {
  it("is true only for identical strings", () => {
    expect(safeEqual("correct horse", "correct horse")).toBe(true);
    expect(safeEqual("correct horse", "correct hors")).toBe(false);
    expect(safeEqual("correct horse", "Correct horse")).toBe(false);
  });

  it("handles different lengths and empty strings", () => {
    expect(safeEqual("short", "a much longer value")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("compares unicode by content", () => {
    expect(safeEqual("pässwörd", "pässwörd")).toBe(true);
    expect(safeEqual("pässwörd", "passwörd")).toBe(false);
  });
});
