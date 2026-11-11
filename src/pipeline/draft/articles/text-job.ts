import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { extractText, getDocumentProxy } from "unpdf";

import { READABILITY_LIMITS } from "@/src/pipeline/draft/articles/html-guard";
import { htmlToText, markdownToText, normalizeText, type TextNodeLike } from "@/src/pipeline/draft/articles/text";

/**
 * The text work on downloaded pages: parsing HTML, Readability, Markdown clean-up, and PDF text. It cannot be
 * interrupted from outside, and a hostile page or PDF can make it take minutes or gigabytes, so the reader runs it
 * in a worker thread (text-worker.ts) that is stopped at the method's text limit.
 */

export type ParseJob =
  /** A web page: its main text, by Readability. */
  | { kind: "readable"; html: string }
  /** An arXiv HTML paper: the whole paper, without references and appendices. */
  | { kind: "arxiv"; html: string }
  /** A README or Jina's Markdown: plain text. */
  | { kind: "markdown"; text: string }
  /** A PDF file: the text of all its pages. */
  | { kind: "pdf"; bytes: Uint8Array };

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

/** The text of every page of a PDF, with unpdf (PDF.js). Throws when the file is not a readable PDF. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  let document: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Verbosity 0: errors only, so a damaged file's warnings do not fill the function log.
    document = await getDocumentProxy(bytes, { verbosity: 0 });
  } catch (error) {
    throw new Error(`Not a readable PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const { text } = await extractText(document, { mergePages: true });
    return normalizeText(text);
  } finally {
    await document.destroy();
  }
}

/** What moves to the worker instead of being copied: a PDF's bytes (up to 20 MB). */
export function transferList(job: ParseJob): ArrayBuffer[] {
  return job.kind === "pdf" ? [job.bytes.buffer as ArrayBuffer] : [];
}

export async function parseJobText(job: ParseJob): Promise<string> {
  switch (job.kind) {
    case "readable":
      return readableText(job.html);
    case "arxiv":
      return arxivPaperText(job.html);
    case "markdown":
      return markdownToText(job.text);
    case "pdf":
      return pdfText(job.bytes);
  }
}
