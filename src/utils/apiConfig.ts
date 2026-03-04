/**
 * Get the correct API URL for Netlify functions
 * Uses explicit NEXT_PUBLIC_NEWSLETTER_URL when provided,
 * otherwise defaults to same-origin Netlify function paths.
 */
export function getApiUrl(endpoint: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_NEWSLETTER_URL?.trim();

  // Explicit override (supports local proxies and production custom domains)
  if (baseUrl) {
    return `${baseUrl.replace(/\/+$/, '')}/${endpoint}`;
  }

  // Default to same-origin path (works in Netlify deploy and netlify dev)
  return `/.netlify/functions/${endpoint}`;
}
