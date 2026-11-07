import { describe, expect, it } from "vitest";

import { pollForTheHour } from "@/src/trigger/poll-loop";

const START = new Date("2026-11-09T15:00:00.000Z");

/** A fake clock: each poll takes 2 seconds, each wait moves the clock on by the waited minutes. */
function fakeRunner(failAt: number[] = []) {
  let clock = START.getTime();
  const pollTimes: string[] = [];
  return {
    pollTimes,
    now: () => new Date(clock),
    poll: async () => {
      pollTimes.push(new Date(clock).toISOString().slice(11, 19));
      clock += 2_000;
      if (failAt.includes(pollTimes.length)) throw new Error(`poll ${pollTimes.length} failed`);
    },
    wait: async (minutes: number) => {
      clock += minutes * 60_000;
    },
  };
}

describe("pollForTheHour", () => {
  it("polls every 5 minutes until the hour ends: 12 polls, the last at about :55", async () => {
    const runner = fakeRunner();

    const result = await pollForTheHour({ start: START, everyMinutes: 5, ...runner });

    expect(result).toEqual({ polls: 12, failures: [] });
    expect(runner.pollTimes[0]).toBe("15:00:00");
    expect(runner.pollTimes[11]).toBe("15:55:22");
  });

  it("keeps polling after a failed poll and reports every failure at the end", async () => {
    const runner = fakeRunner([2, 5]);

    const result = await pollForTheHour({ start: START, everyMinutes: 5, ...runner });

    expect(result).toEqual({ polls: 12, failures: ["poll 2 failed", "poll 5 failed"] });
  });

  it("starts late runs where the hour already is, and still stops at the end of the hour", async () => {
    const runner = fakeRunner();

    const result = await pollForTheHour({ start: new Date(START.getTime() - 40 * 60_000), everyMinutes: 5, ...runner });

    expect(result.polls).toBe(4);
  });
});
