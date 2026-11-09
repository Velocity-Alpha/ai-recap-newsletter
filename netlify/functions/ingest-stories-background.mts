import { describeIngestRun, runIngest } from "@/src/pipeline/ingest/run-ingest";
import { isAuthorizedIngestRequest } from "@/src/pipeline/ingest/start-ingest";

// The ingestion work (ADR 0001). The "-background" name gives it 15 minutes. Only ingest-stories starts it,
// with a short-lived job token. runIngest does nothing while ingest.owner is not `native`.
export default async function ingestStoriesBackground(request: Request): Promise<void> {
  if (!isAuthorizedIngestRequest(request, process.env, new Date())) {
    console.warn("[ingest-stories-background] Rejected a request without a valid job token.");
    return;
  }
  const trigger = process.env.APP_ENV === "production" ? "schedule" : "manual";
  const result = await runIngest("netlify", { trigger });
  console.log(`[ingest-stories-background] ${describeIngestRun(result)}`);
}
