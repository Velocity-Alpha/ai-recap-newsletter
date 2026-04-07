/**
 * Formats a newsletter date for UI display.
 *
 * Why this exists:
 * Postgres DATE values can arrive as midnight UTC timestamps
 * (for example: "2026-03-10T00:00:00.000Z"). If we parse that
 * directly in a negative timezone, the calendar day can shift back
 * by one. This function preserves the intended date by parsing the
 * YYYY-MM-DD portion in local time.
 */
const parseNewsletterDate = (rawDate: string): Date | null => {
  if (!rawDate) {
    return null;
  }

  const dateOnlyMatch = rawDate.split("T")[0].match(/^(\d{4})-(\d{2})-(\d{2})$/);

  const date = dateOnlyMatch
    ? new Date(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3]),
      )
    : new Date(rawDate);

  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatNewsletterDate = (rawDate: string): string => {
  const date = parseNewsletterDate(rawDate);

  if (!date) {
    return "";
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

export const formatNewsletterDateWithWeekday = (rawDate: string): string => {
  const date = parseNewsletterDate(rawDate);

  if (!date) {
    return "";
  }

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};
