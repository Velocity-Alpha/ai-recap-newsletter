import { describe, expect, it } from "vitest";

import { approvalDateKey } from "@/src/features/newsletter/approval-date";

describe("approvalDateKey", () => {
  it("uses the New York date late on Sunday evening, not the UTC date (Monday)", () => {
    // Sunday 2026-11-08 23:30 in New York (EST) is Monday 04:30 UTC.
    expect(approvalDateKey(null, new Date("2026-11-09T04:30:00.000Z"))).toBe("2026-11-08");
  });

  it("uses the New York date in daylight time too", () => {
    // Sunday 2026-07-05 23:30 in New York (EDT) is Monday 03:30 UTC.
    expect(approvalDateKey(null, new Date("2026-07-06T03:30:00.000Z"))).toBe("2026-07-05");
  });

  it("uses the New York date on a weekday morning", () => {
    expect(approvalDateKey(null, new Date("2026-11-09T14:00:00.000Z"))).toBe("2026-11-09");
  });

  it("keeps a valid date parameter", () => {
    expect(approvalDateKey("2026-11-06", new Date("2026-11-09T04:30:00.000Z"))).toBe("2026-11-06");
  });

  it("falls back to the New York date for an empty or invalid date parameter", () => {
    const now = new Date("2026-11-09T04:30:00.000Z");

    expect(approvalDateKey("", now)).toBe("2026-11-08");
    expect(approvalDateKey("not-a-date", now)).toBe("2026-11-08");
  });
});
