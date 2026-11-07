import { logger, schedules } from "@trigger.dev/sdk";

import { runDetectPublish } from "@/src/pipeline/publish/run-detect-publish";

// Publish detection (#63). Every 5 minutes in sending hours on weekdays. While `publish.owner` is `n8n`
// (the default), each run reads one setting and stops; n8n's "3. Gmail Listen - Publish" keeps publishing.
// The Dev environment gets no schedule: run it by hand from the dashboard.
export const detectPublishTask = schedules.task({
  id: "detect-publish",
  cron: { pattern: "*/5 10-19 * * 1-5", timezone: "America/New_York", environments: ["PRODUCTION"] },
  maxDuration: 120,
  run: async () => {
    const result = await runDetectPublish();
    if (!result.summary) {
      logger.info("Publish detection is owned by n8n. Nothing to do.");
      return result;
    }

    const { listed, skipped, results, errors } = result.summary;
    logger.info("Publish detection finished", { owner: result.owner, listed, skipped, results, errors });
    // Fail the run so it shows in the dashboard and retries. Handled messages are skipped on retry.
    if (errors.length > 0) throw new Error(`${errors.length} message(s) failed. See pipeline run ${result.runId}.`);
    return result;
  },
});
