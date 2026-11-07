import {
  describePublishRun,
  runPublishCatchUp,
  throwIfPublishRunFailed,
} from "@/src/pipeline/publish/run-detect-publish";

// Daily publish catch-up (ADR 0001): looks back 3 days for issue emails the poll missed. 03:00 UTC is
// 22:00 New York in winter and 23:00 in summer.
export const config = { schedule: "0 3 * * *" };

export default async function detectPublishCatchUp(): Promise<void> {
  const result = await runPublishCatchUp("netlify");
  console.log(`[detect-publish-catch-up] ${describePublishRun(result)}`);
  throwIfPublishRunFailed(result);
}
