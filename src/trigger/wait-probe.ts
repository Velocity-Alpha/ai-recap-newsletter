import { logger, task, wait } from "@trigger.dev/sdk";

export type WaitProbePayload = { minutes?: number };

export function waitMinutes(payload: WaitProbePayload): number {
  return Math.min(30, Math.max(1, Math.round(payload.minutes ?? 3)));
}

export function summarizeWait(startedAt: Date, resumedAt: Date, requestedMinutes: number) {
  const waitedSeconds = (resumedAt.getTime() - startedAt.getTime()) / 1000;
  return {
    requestedMinutes,
    startedAt: startedAt.toISOString(),
    resumedAt: resumedAt.toISOString(),
    waitedSeconds,
    waitedAtLeastRequested: waitedSeconds >= requestedMinutes * 60,
  };
}

// Test probe for issue #46: proves a long wait.for completes and is not billed.
// maxDuration caps compute time only. A 3-minute wait under a 60-second cap passes only if the wait is not counted.
export const waitProbeTask = task({
  id: "wait-probe",
  maxDuration: 60,
  run: async (payload: WaitProbePayload) => {
    const minutes = waitMinutes(payload);
    const startedAt = new Date();
    await wait.for({ minutes });
    const result = summarizeWait(startedAt, new Date(), minutes);
    logger.info("wait-probe resumed", result);
    return result;
  },
});
