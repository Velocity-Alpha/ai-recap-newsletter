import { describe, expect, it } from "vitest";

import { describeFire } from "./ny-schedule-probe";

describe("describeFire", () => {
  it("shows a winter fire time in New York local time (UTC-5)", () => {
    expect(describeFire(new Date("2026-11-06T16:30:00.000Z"), "America/New_York")).toEqual({
      utc: "2026-11-06T16:30:00.000Z",
      local: "2026-11-06 11:30",
      offset: "GMT-5",
    });
  });

  it("shows a summer fire time in New York local time (UTC-4)", () => {
    expect(describeFire(new Date("2026-07-01T15:30:00.000Z"), "America/New_York")).toEqual({
      utc: "2026-07-01T15:30:00.000Z",
      local: "2026-07-01 11:30",
      offset: "GMT-4",
    });
  });
});
