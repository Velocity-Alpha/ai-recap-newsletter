import { describeStartIngest, startIngestJob } from "@/src/pipeline/ingest/start-ingest";
import type { DeployInfo } from "@/src/pipeline/publish/site-refresh";

// Story ingestion (ADR 0001), 09:55 New York on weekdays like n8n. Netlify schedules run in UTC only, so this
// fires at 13:55 and 14:55 UTC and startIngestJob drops the slot that is not 09:55 in New York. The work
// runs in ingest-stories-background, which can run for 15 minutes.
// The schedule must be a string literal: Netlify reads it from the source and ignores an imported constant,
// which deploys the function unscheduled. A test keeps it equal to INGEST_SCHEDULE.
export const config = { schedule: "55 13,14 * * 1-5" };

export default async function ingestStories(_request: Request, context?: DeployInfo): Promise<void> {
  const result = await startIngestJob(context);
  console.log(`[ingest-stories] ${describeStartIngest(result)}`);
}
