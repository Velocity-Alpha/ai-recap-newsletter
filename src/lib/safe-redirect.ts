/**
 * The path to send someone to after login: `raw` when it resolves to a page on `origin`, otherwise
 * `fallback`. Parsing with URL (rather than checking the first characters) handles every form a browser
 * would read as another host, such as backslashes and stripped tabs.
 */
export function safeRedirectPath(raw: string | null | undefined, origin: string, fallback = "/approval"): string {
  if (!raw) return fallback;

  try {
    const url = new URL(raw, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
