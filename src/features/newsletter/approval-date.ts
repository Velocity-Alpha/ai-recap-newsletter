// Issues go out on New York days, and ingestion names the day the same way.
const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

/**
 * The board's date as YYYY-MM-DD: the `?date=` value when it parses, otherwise today in New York.
 * Today by UTC would be wrong after 19:00 or 20:00 New York time, when UTC is already on the next day.
 */
export function approvalDateKey(value: string | null, now: Date = new Date()): string {
  const parsed = value ? new Date(value) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return NEW_YORK_DATE.format(now);
}
