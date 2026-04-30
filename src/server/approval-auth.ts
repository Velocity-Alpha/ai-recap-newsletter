export const APPROVAL_SESSION_COOKIE_NAME = "approval_session";

export async function createApprovalSessionToken(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`approval:${password}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) return cookies;

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookie.trim().split("=");
    if (!rawName || rawValueParts.length === 0) continue;
    cookies.set(rawName, decodeURIComponent(rawValueParts.join("=")));
  }

  return cookies;
}

export async function hasValidApprovalSession(request: Request): Promise<boolean> {
  const password = process.env.APPROVAL_PASSWORD;
  if (!password) return true;

  const expectedToken = await createApprovalSessionToken(password);
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return cookies.get(APPROVAL_SESSION_COOKIE_NAME) === expectedToken;
}
