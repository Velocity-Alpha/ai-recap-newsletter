import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import {
  APPROVAL_SESSION_COOKIE_NAME,
  getApprovalAuthConfig,
  hasValidApprovalSession,
  isValidApprovalSessionToken,
} from "@/src/server/approval-auth";

/**
 * The one guard for /admin pages and /api/admin routes (#54). It reuses the approval login (#53): the same
 * signed `approval_session` cookie, and it fails closed when APPROVAL_PASSWORD or SESSION_SECRET is unset.
 * proxy.ts checks the same session first; the pages and routes check again here, close to the data.
 * `app/admin/admin-access.test.ts` proves every admin page and route refuses without a session.
 */

/** The approval login has no user names. #83 (per-user login) will put the user's name here. */
export const ADMIN_ACTOR = "approval login";

export type AdminSession = { actor: string };

/** For server components: reads the session cookie through next/headers. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const config = getApprovalAuthConfig();
  if (!config) return null;

  const token = (await cookies()).get(APPROVAL_SESSION_COOKIE_NAME)?.value;
  return (await isValidApprovalSessionToken(token, config)) ? { actor: ADMIN_ACTOR } : null;
}

/** Call first in every admin page. Without a session it redirects to the login, then back to `path`. */
export async function requireAdminPage(path: string): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect(`/approval/login?redirect=${encodeURIComponent(path)}`);
  return session;
}

export async function adminSessionFromRequest(request: Request): Promise<AdminSession | null> {
  return (await hasValidApprovalSession(request)) ? { actor: ADMIN_ACTOR } : null;
}

/** Wrap every admin API handler: `export const POST = withAdminApi(async (request, session) => ...)`. */
export function withAdminApi<Context = unknown>(
  handler: (request: Request, session: AdminSession, context: Context) => Promise<Response>,
): (request: Request, context: Context) => Promise<Response> {
  return async (request, context) => {
    const session = await adminSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    return handler(request, session, context);
  };
}
