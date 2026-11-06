import { describe, expect, it } from "vitest";

import { summarizeWait, waitMinutes } from "./wait-probe";

describe("waitMinutes", () => {
  it("defaults to 3 minutes", () => {
    expect(waitMinutes({})).toBe(3);
  });

  it("keeps the requested minutes between 1 and 30", () => {
    expect(waitMinutes({ minutes: 5 })).toBe(5);
    expect(waitMinutes({ minutes: 0 })).toBe(1);
    expect(waitMinutes({ minutes: 120 })).toBe(30);
  });
});

describe("summarizeWait", () => {
  it("reports the wall-clock time of the wait", () => {
    expect(
      summarizeWait(new Date("2026-11-06T16:00:00.000Z"), new Date("2026-11-06T16:03:02.500Z"), 3),
    ).toEqual({
      requestedMinutes: 3,
      startedAt: "2026-11-06T16:00:00.000Z",
      resumedAt: "2026-11-06T16:03:02.500Z",
      waitedSeconds: 182.5,
      waitedAtLeastRequested: true,
    });
  });

  it("flags a wait that resumed early", () => {
    expect(
      summarizeWait(new Date("2026-11-06T16:00:00.000Z"), new Date("2026-11-06T16:01:00.000Z"), 3)
        .waitedAtLeastRequested,
    ).toBe(false);
  });
});
