import { BROWSER_PAGE_HEADERS } from "@/src/pipeline/browser-headers";
import { guardHtml } from "@/src/pipeline/draft/articles/html-guard";
import { fetchBody, FetchFailure, mediaType, type FetchedBody } from "@/src/pipeline/draft/articles/http";
import { normalizeText } from "@/src/pipeline/draft/articles/text";
import { MethodError, PAGE_MAX_BYTES, PDF_MAX_BYTES, type ArticleMethod, type MethodContext, type MethodText } from "@/src/pipeline/draft/articles/types";

/**
 * Method 2 (#115): fetch the page and take its main text with Mozilla Readability. linkedom stands in for a
 * browser DOM: it is much smaller than jsdom, and gave the same text as jsdom on the pages tried. The HTML guard
 * refuses pages that would make Readability slow, and the parsing runs in the text worker (text-worker.ts).
 * A link that answers with Markdown goes to the Markdown text job. One that answers with a PDF (#170) is kept as
 * bytes (up to 20 MB), read by the PDF text job, and stored under the method `pdf`, also when it fails.
 */

const PDF_TYPE = "application/pdf";
/** No type is read as HTML, like a browser would. */
const PAGE_TYPES = new Set(["", "text/html", "application/xhtml+xml", "text/plain", "text/markdown", PDF_TYPE]);
/** Kept as bytes for the PDF text job, so a PDF link is read from the one download. */
const PDF_BODIES = { types: new Set([PDF_TYPE]), maxBytes: PDF_MAX_BYTES };

/** A failure while reading a PDF, stored under the method `pdf`. */
function asPdfFailure(error: unknown): unknown {
  if (error instanceof MethodError) return new MethodError(error.status, error.message, "pdf");
  return new MethodError("failed", error instanceof Error ? error.message : String(error), "pdf");
}

async function fetchPage(url: string, context: MethodContext): Promise<FetchedBody> {
  try {
    return await fetchBody(url, {
      ...context,
      headers: { ...BROWSER_PAGE_HEADERS },
      maxBytes: PAGE_MAX_BYTES,
      binary: PDF_BODIES,
      // Checked before the body is read, so an image or other file is not downloaded first.
      rejectType: (type) => (PAGE_TYPES.has(type) ? null : `Not an HTML page (${type}).`),
    });
  } catch (error) {
    // A PDF over its cap: the answer was a PDF, so the attempt is a pdf attempt.
    if (error instanceof FetchFailure && error.mediaType === PDF_TYPE) throw asPdfFailure(error);
    throw error;
  }
}

export async function readWithReadability(url: string, context: MethodContext): Promise<MethodText> {
  const page = await fetchPage(url, context);
  const answer = (text: string, method?: ArticleMethod): MethodText => ({ text, httpStatus: page.status, finalUrl: page.url, ...(method ? { method } : {}) });
  if (page.status >= 400) return answer("");
  if (page.kind === "bytes") {
    try {
      return answer(await context.parse({ kind: "pdf", bytes: page.bytes }, context.signal), "pdf");
    } catch (error) {
      throw asPdfFailure(error);
    }
  }
  const type = mediaType(page.contentType);
  if (type === "text/plain") return answer(normalizeText(page.text));
  if (type === "text/markdown") return answer(await context.parse({ kind: "markdown", text: page.text }, context.signal));

  const guarded = guardHtml(page.text);
  if (!guarded.ok) throw new MethodError("failed", guarded.reason);
  return answer(await context.parse({ kind: "readable", html: guarded.html }, context.signal));
}
