/**
 * The caller's IP address. On Netlify, `x-nf-client-connection-ip` is set by Netlify's edge and cannot be
 * set by the client. `x-forwarded-for` is the fallback for local runs.
 */
export function getClientIp(request: Request): string | null {
  const netlifyIp = request.headers.get("x-nf-client-connection-ip")?.trim();
  if (netlifyIp) return netlifyIp;

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedIp || null;
}
