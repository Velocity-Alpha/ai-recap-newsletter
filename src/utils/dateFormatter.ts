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
export const formatNewsletterDate = (rawDate: string): string => {
    if (!rawDate) return "";

    const dateOnlyMatch = rawDate.split('T')[0].match(/^(\d{4})-(\d{2})-(\d{2})$/);

    const date = dateOnlyMatch
        ? new Date(
            Number(dateOnlyMatch[1]),
            Number(dateOnlyMatch[2]) - 1,
            Number(dateOnlyMatch[3])
        )
        : new Date(rawDate);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
};
