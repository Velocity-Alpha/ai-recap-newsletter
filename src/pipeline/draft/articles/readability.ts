import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

import { fetchText } from "@/src/pipeline/draft/articles/http";
import { htmlToText, normalizeText, type TextNodeLike } from "@/src/pipeline/draft/articles/text";
import { MethodError, PAGE_MAX_BYTES, READER_USER_AGENT, type MethodContext, type MethodText } from "@/src/pipeline/draft/articles/types";

/**
 * Method 2 (#115): fetch the page and take its main text with Mozilla Readability. linkedom stands in for a
 * browser DOM: it is much smaller than jsdom, and gave the same text as jsdom on the pages tried.
 */

export const PAGE_HEADERS = {
  "User-Agent": READER_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
};

/** The main text of an HTML document, or "" when Readability finds none. */
export function readableText(html: string): string {
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as Document, { serializer: (node) => node }).parse();
  return article?.content ? htmlToText(article.content as unknown as TextNodeLike) : "";
}

export async function readWithReadability(url: string, context: MethodContext): Promise<MethodText> {
  const page = await fetchText(url, { ...context, headers: PAGE_HEADERS, maxBytes: PAGE_MAX_BYTES });
  if (page.status >= 400) return { text: "", httpStatus: page.status, finalUrl: page.url };

  const type = page.contentType.split(";")[0].trim().toLowerCase();
  if (type === "text/plain") return { text: normalizeText(page.body), httpStatus: page.status, finalUrl: page.url };
  if (type && type !== "text/html" && type !== "application/xhtml+xml") {
    throw new MethodError("failed", `Not an HTML page (${type}).`);
  }
  return { text: readableText(page.body), httpStatus: page.status, finalUrl: page.url };
}
