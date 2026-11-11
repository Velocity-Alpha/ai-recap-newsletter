import { BROWSER_PAGE_HEADERS } from "@/src/pipeline/browser-headers";
import { guardHtml } from "@/src/pipeline/draft/articles/html-guard";
import { fetchText, mediaType } from "@/src/pipeline/draft/articles/http";
import { normalizeText } from "@/src/pipeline/draft/articles/text";
import { MethodError, PAGE_MAX_BYTES, type MethodContext, type MethodText } from "@/src/pipeline/draft/articles/types";

/**
 * Method 2 (#115): fetch the page and take its main text with Mozilla Readability. linkedom stands in for a
 * browser DOM: it is much smaller than jsdom, and gave the same text as jsdom on the pages tried. The HTML guard
 * refuses pages that would make Readability slow, and the parsing runs in the text worker (html-worker.ts).
 */

/** No type is read as HTML, like a browser would. */
const PAGE_TYPES = new Set(["", "text/html", "application/xhtml+xml", "text/plain"]);

export async function readWithReadability(url: string, context: MethodContext): Promise<MethodText> {
  const page = await fetchText(url, {
    ...context,
    headers: { ...BROWSER_PAGE_HEADERS },
    maxBytes: PAGE_MAX_BYTES,
    // Checked before the body is read, so a PDF is not downloaded first.
    rejectType: (type) => (PAGE_TYPES.has(type) ? null : `Not an HTML page (${type}).`),
  });
  if (page.status >= 400) return { text: "", httpStatus: page.status, finalUrl: page.url };
  if (mediaType(page.contentType) === "text/plain") return { text: normalizeText(page.body), httpStatus: page.status, finalUrl: page.url };

  const guarded = guardHtml(page.body);
  if (!guarded.ok) throw new MethodError("failed", guarded.reason);
  const text = await context.parse({ kind: "readable", html: guarded.html }, context.signal);
  return { text, httpStatus: page.status, finalUrl: page.url };
}
