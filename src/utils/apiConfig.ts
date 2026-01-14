/**
 * Get the correct API URL for Netlify functions
 * In development with netlify dev, functions run on port 8888
 * In production, they're available at /.netlify/functions/
 */
export function getApiUrl(endpoint: string): string {
  // If environment variable is set, use it
  if (process.env.NEXT_PUBLIC_NEWSLETTER_URL) {
    return `${process.env.NEXT_PUBLIC_NEWSLETTER_URL}/${endpoint}`;
  }

  // In development, use localhost:8888 (Netlify Dev server)
  if (process.env.NODE_ENV === 'development' || typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return `http://localhost:8888/.netlify/functions/${endpoint}`;
  }

  // In production, use relative path
  return `/.netlify/functions/${endpoint}`;
}

