/**
 * When publish detection runs. Issues so far went out between 10:00 and 17:40 New York time on weekdays.
 * The poll covers 09:00–20:59 on weekdays; a daily catch-up run covers anything outside that.
 */

export const PUBLISH_TIME_ZONE = "America/New_York";

/** The poll runs every 5 minutes, so a 20-minute window sees each email about 4 times. */
export const POLL_LOOKBACK_MINUTES = 20;
/** The daily catch-up looks back 3 days, which also covers a weekend. */
export const CATCH_UP_LOOKBACK_MINUTES = 3 * 24 * 60;

const FIRST_HOUR = 9;
const END_HOUR = 21;
const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

const newYorkParts = new Intl.DateTimeFormat("en-US", {
  timeZone: PUBLISH_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

/** True on weekdays from 09:00 to 20:59 New York time, in both standard and daylight time. */
export function isPublishPollTime(date: Date): boolean {
  const parts = newYorkParts.formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return WEEKDAYS.has(weekday) && hour >= FIRST_HOUR && hour < END_HOUR;
}
