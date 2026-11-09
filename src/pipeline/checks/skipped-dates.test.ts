import { beforeEach, describe, expect, it, vi } from "vitest";

const skippedDate = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/src/server/prisma", () => ({ prisma: { skippedDate } }));

import {
  findSkippedDate,
  markSkippedDate,
  skippedDateProblem,
  unmarkSkippedDate,
} from "@/src/pipeline/checks/skipped-dates";

const ROW = {
  date: new Date("2026-11-10T00:00:00Z"),
  note: "Holiday",
  createdBy: "approval",
  createdAt: new Date("2026-11-10T13:00:00Z"),
};

beforeEach(() => vi.clearAllMocks());

describe("skipped dates", () => {
  it("reads a skipped date as a date key", async () => {
    skippedDate.findUnique.mockResolvedValueOnce(ROW).mockResolvedValueOnce(null);

    await expect(findSkippedDate("2026-11-10")).resolves.toEqual({ ...ROW, date: "2026-11-10" });
    await expect(findSkippedDate("2026-11-11")).resolves.toBeNull();
    expect(skippedDate.findUnique).toHaveBeenCalledWith({ where: { date: new Date("2026-11-10T00:00:00Z") } });
  });

  it("marks a date once; marking it again keeps the first row", async () => {
    skippedDate.upsert.mockResolvedValue(ROW);

    await expect(markSkippedDate("2026-11-10", { note: "Holiday", createdBy: "approval" })).resolves.toEqual({
      ...ROW,
      date: "2026-11-10",
    });
    expect(skippedDate.upsert).toHaveBeenCalledWith({
      where: { date: new Date("2026-11-10T00:00:00Z") },
      create: { date: new Date("2026-11-10T00:00:00Z"), note: "Holiday", createdBy: "approval" },
      update: {},
    });
  });

  it("undoes a skipped date, and says whether there was one", async () => {
    skippedDate.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(unmarkSkippedDate("2026-11-10")).resolves.toBe(true);
    await expect(unmarkSkippedDate("2026-11-10")).resolves.toBe(false);
  });
});

describe("skippedDateProblem", () => {
  const now = new Date("2026-11-10T22:00:00Z"); // Tue 17:00 New York

  it("allows today and later weekdays", () => {
    expect(skippedDateProblem("2026-11-10", now)).toBeNull();
    expect(skippedDateProblem("2026-11-13", now)).toBeNull();
    // 23:30 New York is still Tuesday, though UTC is already Wednesday.
    expect(skippedDateProblem("2026-11-10", new Date("2026-11-11T04:30:00Z"))).toBeNull();
  });

  it("refuses past dates, weekends and bad input", () => {
    expect(skippedDateProblem("2026-11-09", now)).toBe("The date is in the past. Only today or a later date can change.");
    expect(skippedDateProblem("2026-11-14", now)).toBe("The date is not a weekday.");
    expect(skippedDateProblem("2026-02-30", now)).toBe("The date must be YYYY-MM-DD.");
    expect(skippedDateProblem("tomorrow", now)).toBe("The date must be YYYY-MM-DD.");
    expect(skippedDateProblem(null, now)).toBe("The date must be YYYY-MM-DD.");
  });
});
