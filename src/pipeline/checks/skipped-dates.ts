import { newYorkDay } from "@/src/pipeline/checks/schedule";
import { prisma } from "@/src/server/prisma";

/**
 * Skipped dates (GLOSSARY.md): weekdays the owner chose not to publish. "No issue today" on /approval marks
 * one; the check job then skips that date's checks. It can be undone until the day is over.
 */

export interface SkippedDateRecord {
  date: string;
  note: string | null;
  createdBy: string;
  createdAt: Date;
}

/** A date key as stored in a Postgres DATE column. */
export function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function toRecord(row: { date: Date; note: string | null; createdBy: string; createdAt: Date }): SkippedDateRecord {
  return { ...row, date: row.date.toISOString().slice(0, 10) };
}

export async function findSkippedDate(date: string): Promise<SkippedDateRecord | null> {
  const row = await prisma.skippedDate.findUnique({ where: { date: dateOnly(date) } });
  return row ? toRecord(row) : null;
}

/** Marking a date again keeps the first row and its note. */
export async function markSkippedDate(
  date: string,
  input: { note: string | null; createdBy: string },
): Promise<SkippedDateRecord> {
  const row = await prisma.skippedDate.upsert({
    where: { date: dateOnly(date) },
    create: { date: dateOnly(date), note: input.note, createdBy: input.createdBy },
    update: {},
  });
  return toRecord(row);
}

/** True when there was a skipped date to undo. */
export async function unmarkSkippedDate(date: string): Promise<boolean> {
  const { count } = await prisma.skippedDate.deleteMany({ where: { date: dateOnly(date) } });
  return count > 0;
}

/** Why this date cannot be marked or unmarked now, or null when it can: a weekday, today or later in New York. */
export function skippedDateProblem(date: string | null, now: Date): string | null {
  const valid = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && dateOnly(date).toISOString().startsWith(date);
  if (!valid) return "The date must be YYYY-MM-DD.";
  if (date < newYorkDay(now).date) return "The date is in the past. Only today or a later date can change.";
  const weekday = dateOnly(date).getUTCDay();
  if (weekday === 0 || weekday === 6) return "The date is not a weekday.";
  return null;
}
