import { describe, expect, it } from "vitest";

import {
  parseReuseDraftDates,
  toggleReuseDraftDate,
} from "@/src/features/newsletter/reuse-drafts-param";

describe("parseReuseDraftDates", () => {
  it("keeps valid dates once, in order", () => {
    expect(parseReuseDraftDates("2026-10-22,2026-10-21,2026-10-22")).toEqual([
      "2026-10-21",
      "2026-10-22",
    ]);
  });

  it("ignores anything that is not a real date", () => {
    expect(parseReuseDraftDates("2026-13-40,2026-02-30,yesterday, 2026-10-22 ,")).toEqual([
      "2026-10-22",
    ]);
    expect(parseReuseDraftDates(null)).toEqual([]);
    expect(parseReuseDraftDates("")).toEqual([]);
  });
});

describe("toggleReuseDraftDate", () => {
  it("adds a date that is not reused yet", () => {
    expect(toggleReuseDraftDate(["2026-10-22"], "2026-10-21")).toBe("2026-10-21,2026-10-22");
  });

  it("removes a date that is already reused", () => {
    expect(toggleReuseDraftDate(["2026-10-21", "2026-10-22"], "2026-10-22")).toBe("2026-10-21");
    expect(toggleReuseDraftDate(["2026-10-22"], "2026-10-22")).toBe("");
  });
});
