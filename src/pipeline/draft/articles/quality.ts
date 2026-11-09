/**
 * The run-time text check from #115 (docs/research/article-reading.md, "Success rule"): there is no ground truth at
 * run time, so a method's text is used when the page answered under HTTP 400, has at least 500 characters, and is
 * not a block page or a paywall. Block-page and page-shell phrases are only checked on short texts, because long
 * articles mention "captcha" in their cookie banners. #115 found one page shell this check accepts (a dashboard
 * whose data loads in the browser, with real prose around it); no cheap rule separates it from a short article.
 */

export type ArticleStatus = "read" | "paywalled" | "blocked" | "failed";
export type NotReadStatus = Exclude<ArticleStatus, "read">;

export type TextVerdict = { ok: true } | { ok: false; status: NotReadStatus; reason: string };

export const MIN_ARTICLE_CHARS = 500;
const SHORT_TEXT_CHARS = 2_500;
// A paywall shows a teaser and a prompt; a full article that mentions subscribing is longer than this.
const PAYWALL_CHECK_CHARS = 5_000;

const BLOCK_PHRASES = [
  "just a moment",
  "verify you are human",
  "verify you are a human",
  "verifying you are human",
  "are you a robot",
  "not a robot",
  "captcha",
  "checking your browser",
  "checking if the site connection is secure",
  "access denied",
  "attention required",
  "unusual traffic",
  "you have been blocked",
  "you've been blocked",
  "request blocked",
  "request unsuccessful",
  "pardon our interruption",
  "press & hold",
  "press and hold",
  "ddos protection",
];

const PAYWALL_PHRASES = [
  "subscribe to continue",
  "subscribe to keep reading",
  "subscribe to read the full",
  "subscribe now to read",
  "subscribers only",
  "this article is for subscribers",
  "this post is for paid subscribers",
  "this post is for paying subscribers",
  "create a free account to continue",
  "sign in to continue reading",
  "log in to continue reading",
  "register to continue reading",
  "start your free trial to continue",
  "reached your free article limit",
  "reached your limit of free articles",
];

const SHELL_PHRASES = [
  "enable javascript",
  "javascript is required",
  "javascript is disabled",
  "requires javascript",
  "turn on javascript",
  "javascript to run this app",
];

/** 401, 403, 407 and 429 are bot blocks or login walls; 402 is a paywall; anything else is a failure. */
export function statusForHttp(status: number): NotReadStatus {
  if (status === 402) return "paywalled";
  if (status === 401 || status === 403 || status === 407 || status === 429) return "blocked";
  return "failed";
}

function mentions(text: string, phrases: string[]): boolean {
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  return phrases.some((phrase) => lower.includes(phrase));
}

export function checkArticleText(text: string, httpStatus: number): TextVerdict {
  if (httpStatus >= 400) return { ok: false, status: statusForHttp(httpStatus), reason: `HTTP ${httpStatus}.` };
  const chars = text.trim().length;
  const short = chars < SHORT_TEXT_CHARS;
  if (short && mentions(text, BLOCK_PHRASES)) return { ok: false, status: "blocked", reason: "A bot check or block page." };
  if (chars < PAYWALL_CHECK_CHARS && mentions(text, PAYWALL_PHRASES)) return { ok: false, status: "paywalled", reason: "A paywall." };
  if (short && mentions(text, SHELL_PHRASES)) return { ok: false, status: "failed", reason: "A page shell that needs JavaScript." };
  if (chars < MIN_ARTICLE_CHARS) return { ok: false, status: "failed", reason: `Only ${chars} characters of text.` };
  return { ok: true };
}
