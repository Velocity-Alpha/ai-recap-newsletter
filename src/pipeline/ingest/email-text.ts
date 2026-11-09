import { HTMLElement, NodeType, parse, type Node } from "node-html-parser";

/**
 * Turns an HTML email into plain text with Markdown links, for sources whose plain-text part is poor
 * (AlphaSignal). n8n did the same with its `HTML Strip` and `Markdown` nodes.
 */

const DROPPED = "style, script, head, title, noscript, img, svg";
const BLOCKS = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "table", "tbody", "thead", "tr", "ul", "ol", "pre", "hr", "center",
]);

function render(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) return node.text.replace(/\s+/g, " ");
  if (!(node instanceof HTMLElement)) return "";

  const tag = node.tagName?.toLowerCase() ?? "";
  const inner = node.childNodes.map(render).join("");
  if (tag === "br") return "\n";
  if (tag === "a") {
    const href = node.getAttribute("href")?.trim();
    const label = inner.replace(/\s+/g, " ").trim();
    if (!label) return "";
    return href && /^https?:/i.test(href) ? `[${label}](${href})` : label;
  }
  if (tag === "li") return `\n- ${inner.trim()}`;
  if (tag === "td" || tag === "th") return `${inner} `;
  if (BLOCKS.has(tag)) return `\n\n${inner}\n\n`;
  return inner;
}

export function htmlToText(html: string): string {
  if (!html.trim()) return "";
  const root = parse(html, { comment: false });
  for (const element of root.querySelectorAll(DROPPED)) element.remove();

  const lines = render(root)
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  const kept: string[] = [];
  for (const line of lines) {
    if (line === "" && (kept.length === 0 || kept[kept.length - 1] === "")) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}
