import {
  describePublishRun,
  runPublishPoll,
  throwIfPublishRunFailed,
} from "@/src/pipeline/publish/run-detect-publish";
import { createNetlifySiteRefresher, type DeployInfo } from "@/src/pipeline/publish/site-refresh";

// Publish detection poll (ADR 0001). Netlify schedules run in UTC only, so this fires every 5 minutes in the
// UTC hours that hold 09:00–20:59 New York time in both EST and EDT. runPublishPoll drops the other runs.
// It checks Gmail first and opens the database only when an issue email arrived in the last 20 minutes.
export const config = { schedule: "*/5 0,1,13-23 * * *" };

export default async function detectPublish(_request: Request, context?: DeployInfo): Promise<void> {
  const result = await runPublishPoll("netlify", { refreshSite: createNetlifySiteRefresher(context) });
  console.log(`[detect-publish] ${describePublishRun(result)}`);
  throwIfPublishRunFailed(result);
}
