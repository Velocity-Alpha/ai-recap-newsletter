import { describe, expect, it } from "vitest";

import { isPublishPollTime } from "@/src/pipeline/publish/publish-schedule";

describe("isPublishPollTime", () => {
  it.each([
    ["Monday 09:00 New York in winter (EST)", "2026-11-09T14:00:00.000Z", true],
    ["Monday 08:55 New York in winter", "2026-11-09T13:55:00.000Z", false],
    ["Monday 20:55 New York in winter, already Tuesday in UTC", "2026-11-10T01:55:00.000Z", true],
    ["Monday 21:00 New York in winter", "2026-11-10T02:00:00.000Z", false],
    ["Monday 09:00 New York in summer (EDT)", "2026-07-06T13:00:00.000Z", true],
    ["Monday 08:55 New York in summer", "2026-07-06T12:55:00.000Z", false],
    ["Friday 20:55 New York in summer, already Saturday in UTC", "2026-07-11T00:55:00.000Z", true],
    ["Saturday midday New York", "2026-11-07T17:00:00.000Z", false],
    ["Sunday 20:00 New York, Monday in UTC", "2026-11-09T01:00:00.000Z", false],
  ])("%s → %s", (_label, iso, expected) => {
    expect(isPublishPollTime(new Date(iso))).toBe(expected);
  });
});
