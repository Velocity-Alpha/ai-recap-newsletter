import { describe, expect, it } from "vitest";

import { INGEST_SCHEDULE, isIngestTime } from "@/src/pipeline/ingest/schedule";

describe("isIngestTime", () => {
  it("is true at 09:55 New York on weekdays, in both standard and daylight time", () => {
    expect(isIngestTime(new Date("2026-11-09T14:55:00Z"))).toBe(true); // Mon, EST
    expect(isIngestTime(new Date("2026-07-06T13:55:00Z"))).toBe(true); // Mon, EDT
  });

  it("is false for the other UTC slot of the same day", () => {
    expect(isIngestTime(new Date("2026-11-09T13:55:00Z"))).toBe(false); // 08:55 EST
    expect(isIngestTime(new Date("2026-07-06T14:55:00Z"))).toBe(false); // 10:55 EDT
  });

  it("is false on weekends", () => {
    expect(isIngestTime(new Date("2026-11-07T14:55:00Z"))).toBe(false); // Sat
  });

  it("schedules both UTC slots on weekdays", () => {
    expect(INGEST_SCHEDULE).toBe("55 13,14 * * 1-5");
  });
});
