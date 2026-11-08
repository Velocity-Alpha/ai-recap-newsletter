import {
  describePublishRun,
  runPublishCatchUp,
  throwIfPublishRunFailed,
} from "@/src/pipeline/publish/run-detect-publish";
import { createNetlifySiteRefresher, type DeployInfo } from "@/src/pipeline/publish/site-refresh";

// Daily publish catch-up (ADR 0001): looks back 3 days for issue emails the poll missed. 03:00 UTC is
// 22:00 New York in winter and 23:00 in summer.
export const config = { schedule: "0 3 * * *" };

export default async function detectPublishCatchUp(_request: Request, context?: DeployInfo): Promise<void> {
  const result = await runPublishCatchUp("netlify", { refreshSite: createNetlifySiteRefresher(context) });
  console.log(`[detect-publish-catch-up] ${describePublishRun(result)}`);
  throwIfPublishRunFailed(result);
}
