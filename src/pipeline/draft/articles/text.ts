/** Plain text from a DOM element or Markdown, with paragraph breaks kept for the writer. */

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "dd", "details", "div", "dl", "dt", "figcaption", "figure", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary",
  "table", "tr", "ul",
]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "iframe", "button", "form", "select", "input", "textarea"]);

/** The DOM surface this needs, so linkedom nodes fit without its types leaking out. */
export interface TextNodeLike {
  nodeType: number;
  nodeValue?: string | null;
  localName?: string;
  childNodes: ArrayLike<TextNodeLike> | Iterable<TextNodeLike>;
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(root: TextNodeLike): string {
  const out: string[] = [];
  const walk = (node: TextNodeLike) => {
    if (node.nodeType === 3) {
      out.push((node.nodeValue ?? "").replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    const tag = node.localName?.toLowerCase() ?? "";
    if (SKIP_TAGS.has(tag)) return;
    if (tag === "br") return void out.push("\n");
    // List items and table rows start a line; other blocks are paragraphs with a blank line around them.
    const line = tag === "li" || tag === "tr";
    const block = !line && BLOCK_TAGS.has(tag);
    if (line) out.push(tag === "li" ? "\n- " : "\n");
    if (block) out.push("\n\n");
    if (tag === "td" || tag === "th") out.push(" ");
    for (const child of Array.from(node.childNodes as ArrayLike<TextNodeLike>)) walk(child);
    if (block) out.push("\n\n");
  };
  walk(root);
  return normalizeText(out.join(""));
}

export function markdownToText(markdown: string): string {
  const text = markdown
    .replace(/^﻿?---\n[\s\S]*?\n---\n/, "") // YAML front matter (Hugging Face model cards)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "") // linked badges
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1") // links keep their text
    .replace(/<[^>]+>/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/gm, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1");
  return normalizeText(text);
}
