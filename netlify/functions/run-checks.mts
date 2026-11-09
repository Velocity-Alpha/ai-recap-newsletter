import { describeRunChecks, runChecks } from "@/src/pipeline/checks/run-checks";
import { PUBLIC_SITE_URL } from "@/src/pipeline/checks/site";
import { siteUrlForDeploy, type DeployInfo } from "@/src/pipeline/publish/site-refresh";

// The check job (#50, #52, ADR 0001): 10:05, 12:00 and 18:00 New York time on weekdays (CHECK_TIMES in
// src/pipeline/checks/schedule.ts). Netlify schedules run in UTC only, so this fires at :00 and :05 in the
// UTC hours that hold those times under EDT and EST, and runChecks acts only at a check time.
// The schedule must be a string literal: Netlify reads it from the source and ignores an imported constant.
// A test keeps it equal to CHECK_SCHEDULE.
export const config = { schedule: "0,5 14,15,16,17,22,23 * * 1-5" };

export default async function runChecksFunction(_request: Request, context?: DeployInfo): Promise<void> {
  // Production checks the public site. A preview ("Run now") checks its own deploy, which reads Neon dev.
  const preview = process.env.APP_ENV !== "production" && context?.site && context.deploy;
  const siteUrl = preview ? siteUrlForDeploy(context) || PUBLIC_SITE_URL : PUBLIC_SITE_URL;
  const result = await runChecks({ siteUrl });
  console.log(`[run-checks] ${describeRunChecks(result)}`);
}
