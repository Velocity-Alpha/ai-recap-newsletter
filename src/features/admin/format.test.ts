import { describe, expect, it } from "vitest";

import { formatDuration, formatTime } from "@/src/features/admin/format";

describe("formatTime", () => {
  it("shows New York time with the zone, in standard and daylight time", () => {
    expect(formatTime(new Date("2026-11-09T14:55:03Z"))).toBe("Mon, Nov 9, 9:55:03 AM EST");
    expect(formatTime(new Date("2026-10-30T13:55:00Z"))).toBe("Fri, Oct 30, 9:55:00 AM EDT");
  });

  it("shows a dash for no time", () => {
    expect(formatTime(null)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("picks a unit that reads well", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(16_240)).toBe("16.2 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
    expect(formatDuration(3_780_000)).toBe("1 h 3 min");
  });

  it("shows a dash for a run still going", () => {
    expect(formatDuration(null)).toBe("—");
  });
});
