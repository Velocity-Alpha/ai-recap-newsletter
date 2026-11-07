import { logger, schedules, wait } from "@trigger.dev/sdk";

import {
  describePublishRun,
  runPublishCatchUp,
  runPublishPoll,
  throwIfPublishRunFailed,
} from "@/src/pipeline/publish/run-detect-publish";
import { PUBLISH_TIME_ZONE } from "@/src/pipeline/publish/publish-schedule";
import { pollForTheHour } from "@/src/trigger/poll-loop";

// Dormant: the Netlify functions in netlify/functions/ run publish detection (ADR 0001). These tasks act only
// after a Trigger.dev Production deploy AND `pipeline.runner` = "trigger"; until then they stop after the Gmail
// check. Same logic and settings as the Netlify adapters.
// window "0m": SDK 4.8 otherwise delays each scheduled run by up to 60 minutes.

/** Free plan: schedules fire at most hourly, so each hourly run polls every 5 minutes (waits are free). */
export const detectPublishTask = schedules.task({
  id: "detect-publish",
  cron: { pattern: "0 9-20 * * 1-5", timezone: PUBLISH_TIME_ZONE, window: "0m", environments: ["PRODUCTION"] },
  maxDuration: 300,
  run: async (payload) => {
    const { polls, failures } = await pollForTheHour({
      start: payload.timestamp,
      everyMinutes: 5,
      wait: (minutes) => wait.for({ minutes }),
      poll: async () => {
        const result = await runPublishPoll("trigger");
        logger.info(describePublishRun(result));
        throwIfPublishRunFailed(result);
      },
    });
    if (failures.length > 0) throw new Error(`${failures.length} of ${polls} polls failed: ${failures.join(" | ")}`);
    return { polls };
  },
});

export const detectPublishCatchUpTask = schedules.task({
  id: "detect-publish-catch-up",
  cron: { pattern: "0 22 * * *", timezone: PUBLISH_TIME_ZONE, window: "0m", environments: ["PRODUCTION"] },
  maxDuration: 120,
  run: async () => {
    const result = await runPublishCatchUp("trigger");
    logger.info(describePublishRun(result));
    throwIfPublishRunFailed(result);
    return result;
  },
});
