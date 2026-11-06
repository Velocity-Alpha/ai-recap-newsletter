import { logger, schedules } from "@trigger.dev/sdk";

export const NY_TIMEZONE = "America/New_York";

export function describeFire(timestamp: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "shortOffset",
    })
      .formatToParts(timestamp)
      .map((part) => [part.type, part.value]),
  );

  return {
    utc: timestamp.toISOString(),
    local: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
    offset: parts.timeZoneName,
  };
}

// Test probe for issue #46: proves a schedule fires at New York wall-clock time.
// 11:45 New York is 16:45 UTC in winter and 15:45 UTC in summer. Remove it once the outcome checks (#50) exist.
// window "0m": without it, Trigger.dev delays each run by a stable offset of up to 60 minutes after the cron time.
export const nyScheduleProbe = schedules.task({
  id: "ny-schedule-probe",
  cron: { pattern: "45 11 * * *", timezone: NY_TIMEZONE, window: "0m" },
  maxDuration: 30,
  run: async (payload) => {
    const fired = describeFire(payload.timestamp, payload.timezone);
    const result = {
      scheduleTimezone: payload.timezone,
      fired,
      lastFired: payload.lastTimestamp ? describeFire(payload.lastTimestamp, payload.timezone).local : null,
      next: payload.upcoming.slice(0, 2).map((date) => describeFire(date, payload.timezone).local),
    };
    logger.info("ny-schedule-probe fired", result);
    return result;
  },
});
