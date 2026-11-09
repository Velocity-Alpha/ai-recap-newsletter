import { describe, expect, it } from "vitest";

import {
  CHECK_SCHEDULE,
  CHECK_TIMES,
  checkTimeAt,
  newYorkClock,
  newYorkDay,
  newYorkTime,
  shiftDate,
} from "@/src/pipeline/checks/schedule";

/** The UTC instants a 5-field cron with plain lists and ranges fires at on one UTC day. */
function cronFires(cron: string, utcDay: string): Date[] {
  const [minutes, hours, , , weekdays] = cron.split(" ").map((field) =>
    field === "*"
      ? null
      : field.split(",").flatMap((part) => {
          const [from, to] = part.split("-").map(Number);
          return Array.from({ length: (to ?? from) - from + 1 }, (_, index) => from + index);
        }),
  );
  const day = new Date(`${utcDay}T00:00:00Z`);
  if (weekdays && !weekdays.includes(day.getUTCDay())) return [];
  return (hours ?? []).flatMap((hour) =>
    (minutes ?? []).map((minute) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute))),
  );
}

// A full working week in each offset: EDT (UTC-4) in July, EST (UTC-5) in November.
const EDT_WEEK = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"];
const EST_WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];

describe("check schedule", () => {
  it("is the literal cron the Netlify function uses", () => {
    expect(CHECK_SCHEDULE).toBe("0,5 14,15,16,17,22,23 * * 1-5");
    expect(CHECK_TIMES).toEqual(["10:05", "12:00", "18:00"]);
  });

  it("fires at every check time on every weekday, in both daylight and standard time", () => {
    for (const date of [...EDT_WEEK, ...EST_WEEK]) {
      const fires = cronFires(CHECK_SCHEDULE, date).map((fire) => fire.getTime());
      for (const time of CHECK_TIMES) {
        expect(fires, `${date} ${time}`).toContain(newYorkTime(date, time).getTime());
      }
    }
  });

  it("acts on exactly one fire per check time each weekday", () => {
    for (const date of [...EDT_WEEK, ...EST_WEEK]) {
      const acting = cronFires(CHECK_SCHEDULE, date).flatMap((fire) => checkTimeAt(fire) ?? []);
      expect(acting, date).toEqual(["10:05", "12:00", "18:00"]);
    }
  });

  it("acts a few seconds late, but not at the other fires of the hour", () => {
    expect(checkTimeAt(new Date("2026-11-09T15:05:20Z"))).toBe("10:05"); // Mon 10:05:20 EST
    expect(checkTimeAt(new Date("2026-11-09T15:00:00Z"))).toBeNull(); // 10:00 EST
    expect(checkTimeAt(new Date("2026-07-06T16:05:00Z"))).toBeNull(); // 12:05 EDT
    expect(checkTimeAt(new Date("2026-07-06T22:00:00Z"))).toBe("18:00"); // 18:00 EDT
  });

  it("accepts a fire from 1 minute early to 4 minutes late", () => {
    expect(checkTimeAt(new Date("2026-11-09T15:04:00Z"))).toBe("10:05"); // 10:04 EST
    expect(checkTimeAt(new Date("2026-11-09T15:03:59Z"))).toBeNull(); // 10:03 EST
    expect(checkTimeAt(new Date("2026-11-09T15:09:59Z"))).toBe("10:05"); // 10:09 EST
    expect(checkTimeAt(new Date("2026-11-09T15:10:00Z"))).toBeNull(); // 10:10 EST
    expect(checkTimeAt(new Date("2026-07-06T15:59:30Z"))).toBe("12:00"); // 11:59 EDT
    expect(checkTimeAt(new Date("2026-11-09T22:59:00Z"))).toBe("18:00"); // 17:59 EST
  });

  it("never acts on a weekend", () => {
    expect(checkTimeAt(new Date("2026-11-07T15:05:00Z"))).toBeNull(); // Sat 10:05 EST
    expect(checkTimeAt(new Date("2026-11-08T23:00:00Z"))).toBeNull(); // Sun 18:00 EST
  });
});

describe("newYorkDay", () => {
  it("gives the New York date and weekday, not the UTC one", () => {
    expect(newYorkDay(new Date("2026-11-10T03:00:00Z"))).toEqual({ date: "2026-11-09", weekday: "Mon" });
    expect(newYorkDay(new Date("2026-11-09T23:00:00Z"))).toEqual({ date: "2026-11-09", weekday: "Mon" });
  });
});

describe("newYorkTime", () => {
  it("turns a New York wall time into an instant in either offset", () => {
    expect(newYorkTime("2026-11-09", "00:00").toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(newYorkTime("2026-07-06", "18:00").toISOString()).toBe("2026-07-06T22:00:00.000Z");
  });
});

describe("shiftDate", () => {
  it("moves a date key by whole days, across months and the daylight-saving switch", () => {
    expect(shiftDate("2026-11-02", -3)).toBe("2026-10-30");
    expect(shiftDate("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDate("2026-03-09", -7)).toBe("2026-03-02");
  });
});

describe("newYorkClock", () => {
  it("shows an instant as a New York wall time", () => {
    expect(newYorkClock(new Date("2026-11-09T16:42:00Z"))).toBe("11:42");
    expect(newYorkClock(new Date("2026-07-06T22:05:00Z"))).toBe("18:05");
  });
});
