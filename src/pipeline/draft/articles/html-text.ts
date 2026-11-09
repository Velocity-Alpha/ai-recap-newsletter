import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

import { READABILITY_LIMITS } from "@/src/pipeline/draft/articles/html-guard";
import { htmlToText, markdownToText, type TextNodeLike } from "@/src/pipeline/draft/articles/text";

/**
 * The synchronous text work on downloaded pages: parsing HTML, Readability, and Markdown clean-up. It cannot be
 * interrupted, and a hostile page can make it take minutes or gigabytes, so the reader runs it in a worker thread
 * (html-worker.ts) that is stopped at the method's timeout.
 */

export type ParseJob =
  /** A web page: its main text, by Readability. */
  | { kind: "readable"; html: string }
  /** An arXiv HTML paper: the whole paper, without references and appendices. */
  | { kind: "arxiv"; html: string }
  /** A README or Jina's Markdown: plain text. */
  | { kind: "markdown"; text: string };

/** The main text of an HTML document, or "" when Readability finds none. */
export function readableText(html: string): string {
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as Document, {
    serializer: (node) => node,
    // Readability counts the elements first and gives up past this: a few more than the HTML guard allows, for the
    // html, head and body elements the parser adds.
    maxElemsToParse: READABILITY_LIMITS.maxElements + 10,
  }).parse();
  return article?.content ? htmlToText(article.content as unknown as TextNodeLike) : "";
}

/** The arXiv paper's text: drops the references, appendices and contents list, and writes math as its TeX. */
export function arxivPaperText(html: string): string {
  const { document } = parseHTML(html);
  const paper = document.querySelector("article.ltx_document") ?? document.querySelector("article") ?? document.body;
  if (!paper) return "";
  for (const node of paper.querySelectorAll(".ltx_bibliography, .ltx_appendix, nav, .ltx_pagination, .ltx_page_navbar")) node.remove();
  for (const math of paper.querySelectorAll("math")) {
    math.replaceWith(document.createTextNode(` ${math.getAttribute("alttext") ?? ""} `));
  }
  return htmlToText(paper as unknown as TextNodeLike);
}

export function parseJobText(job: ParseJob): string {
  switch (job.kind) {
    case "readable":
      return readableText(job.html);
    case "arxiv":
      return arxivPaperText(job.html);
    case "markdown":
      return markdownToText(job.text);
  }
}
