import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  APPROVAL_SESSION_COOKIE_NAME,
  getApprovalAuthConfig,
  isValidApprovalSessionToken,
} from "@/src/server/approval-auth";

/**
 * For server pages under /approval: sends the visitor to the approval login unless they hold a valid
 * session. proxy.ts checks the same thing first; this keeps the page safe if the proxy is skipped.
 */
export async function requireApprovalSession(returnTo: string): Promise<void> {
  const config = getApprovalAuthConfig();
  const token = (await cookies()).get(APPROVAL_SESSION_COOKIE_NAME)?.value;

  if (!config || !(await isValidApprovalSessionToken(token, config))) {
    redirect(`/approval/login?redirect=${encodeURIComponent(returnTo)}`);
  }
}
