/**
 * The request headers of a current desktop Chrome opening a page from the address bar. Some sites send a bot
 * challenge to any other client. The article reader's page method sends all of them; ingestion's redirect
 * follower and paywall check send the user agent. The site adapters and Jina are APIs and use the reader's own
 * name instead (READER_USER_AGENT). Keep this file free of `next/*`: Netlify functions import it.
 */

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

/** HTML first, as Chrome asks; Markdown, plain text and PDF are also wanted. */
export const BROWSER_PAGE_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent": BROWSER_USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,text/markdown;q=0.8,text/plain;q=0.8,application/pdf;q=0.8,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};
