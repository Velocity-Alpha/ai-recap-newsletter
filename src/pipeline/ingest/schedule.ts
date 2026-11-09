/**
 * Ingestion runs once a day at 09:55 New York time, Monday to Friday, like n8n. Netlify schedules run in
 * UTC, so the function fires at 13:55 and 14:55 UTC and only the slot that is 09:55 in New York goes ahead.
 */

export const INGEST_SCHEDULE = "55 13,14 * * 1-5";

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
const newYorkParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

export function isIngestTime(date: Date): boolean {
  const parts = newYorkParts.formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return WEEKDAYS.has(weekday) && hour === 9;
}
