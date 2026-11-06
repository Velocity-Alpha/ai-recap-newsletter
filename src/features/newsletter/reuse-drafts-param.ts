// Shared by the approval page (browser) and its API routes, so it must not import server code.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Reads the board's `reuse` parameter: comma-separated YYYY-MM-DD dates of
 * unsent drafts whose stories go back into the pool.
 */
export function parseReuseDraftDates(value: string | null): string[] {
  if (!value) return [];
  const dates = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => DATE_ONLY.test(part) && isRealDate(part));
  return Array.from(new Set(dates)).sort();
}

/** Adds the date if missing, removes it if present. Returns the parameter value. */
export function toggleReuseDraftDate(current: readonly string[], date: string): string {
  const next = new Set(current);
  if (next.has(date)) next.delete(date);
  else next.add(date);
  return Array.from(next).sort().join(",");
}
