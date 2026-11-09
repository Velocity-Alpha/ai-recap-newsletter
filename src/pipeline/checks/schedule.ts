/**
 * The check job (#50, #52) runs at 10:05, 12:00 and 18:00 New York time, Monday to Friday. Netlify schedules
 * run in UTC only, so the cron fires at :00 and :05 in each check time's UTC hour under both EDT (UTC-4) and
 * EST (UTC-5): 14:05/15:05, 16:00/17:00 and 22:00/23:00. Only the fire that is a check time in New York acts.
 * netlify/functions/run-checks.mts repeats CHECK_SCHEDULE as a literal; a test keeps the two equal.
 */

export const CHECK_SCHEDULE = "0,5 14,15,16,17,22,23 * * 1-5";

export const CHECK_TIMES = ["10:05", "12:00", "18:00"] as const;
export type CheckTime = (typeof CHECK_TIMES)[number];

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export const WEEKDAY_NAMES: Record<Weekday, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

const TIME_ZONE = "America/New_York";
const WEEKDAYS = new Set<Weekday>(["Mon", "Tue", "Wed", "Thu", "Fri"]);
/** A fire acts if it lands this many minutes after a check time or less. The next fire is 5 minutes on. */
const LATE_MINUTES = 4;

const newYorkParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsOf(date: Date) {
  const parts = Object.fromEntries(newYorkParts.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday as Weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function minutesOf(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/** The New York date (YYYY-MM-DD) and weekday of an instant. */
export function newYorkDay(date: Date): { date: string; weekday: Weekday } {
  const { date: day, weekday } = partsOf(date);
  return { date: day, weekday };
}

/** An instant as a New York wall time, "HH:MM". */
export function newYorkClock(date: Date): string {
  const { minutes } = partsOf(date);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The instant of a New York wall time ("HH:MM") on a date, in whichever offset applies that day. */
export function newYorkTime(date: string, time: string): Date {
  const wall = new Date(`${date}T${time}:00Z`).getTime();
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(wall + offsetHours * 3_600_000);
    const parts = partsOf(candidate);
    if (parts.date === date && parts.minutes === minutesOf(time)) return candidate;
  }
  return new Date(wall + 5 * 3_600_000);
}

/** The check time this instant acts as, or null: weekdays only, within a few minutes after the time. */
export function checkTimeAt(date: Date): CheckTime | null {
  const { weekday, minutes } = partsOf(date);
  if (!WEEKDAYS.has(weekday)) return null;
  return CHECK_TIMES.find((time) => minutes - minutesOf(time) >= 0 && minutes - minutesOf(time) <= LATE_MINUTES) ?? null;
}
