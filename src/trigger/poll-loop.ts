/**
 * Trigger.dev Free rejects schedules that fire more than once an hour. An hourly run calls this to poll every
 * few minutes; `wait.for` waits are not billed. A failed poll does not end the hour: failures are collected so
 * the run can fail once at the end.
 */
export async function pollForTheHour(options: {
  /** The scheduled time of this hourly run. */
  start: Date;
  everyMinutes: number;
  poll: () => Promise<void>;
  wait: (minutes: number) => Promise<void>;
  now?: () => Date;
}): Promise<{ polls: number; failures: string[] }> {
  const now = options.now ?? (() => new Date());
  const end = options.start.getTime() + 60 * 60_000;
  const step = options.everyMinutes * 60_000;
  const failures: string[] = [];
  let polls = 0;

  for (;;) {
    polls += 1;
    try {
      await options.poll();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    // The next hourly run takes over at the top of the hour.
    if (now().getTime() + step >= end) break;
    await options.wait(options.everyMinutes);
  }

  return { polls, failures };
}
