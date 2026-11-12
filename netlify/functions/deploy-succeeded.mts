import { describeWarmUp, warmDeploy } from "@/src/pipeline/publish/deploy-warm-up";
import type { DeployInfo } from "@/src/pipeline/publish/site-refresh";

// Netlify runs this function when a deploy succeeds (the file name is the event name). Each deploy clears the
// CDN, so it loads the home page, the archive, and the newest issue once, and the first reader gets a cached
// page. A failed page load is only logged: the page still works, its first reader just waits for a render.
export default async function deploySucceeded(request: Request, context?: DeployInfo): Promise<void> {
  const report = await warmDeploy(request, context);
  console.log(`[deploy-succeeded] ${describeWarmUp(report)}`);
}
