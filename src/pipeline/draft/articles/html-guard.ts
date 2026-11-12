/**
 * A cheap check of a page before Readability, in one linear pass over the HTML. Readability's time grows fast with
 * how deep tags nest (#120 review: 800 levels took 1.4 s, 4,000 took 122 s) and its memory with the number of
 * elements, so a page past these limits is refused here, in milliseconds. The worker (text-worker.ts) is still the
 * hard stop for pages that pass.
 *
 * It also drops what Readability throws away anyway (scripts, styles, SVG, templates, comments), so the size cap
 * measures the page, not its JavaScript.
 */

export interface HtmlLimits {
  /** Characters left after scripts, styles, SVG, templates and comments are dropped. */
  maxChars: number;
  maxDepth: number;
  maxElements: number;
}

export const READABILITY_LIMITS: HtmlLimits = { maxChars: 1_500_000, maxDepth: 400, maxElements: 30_000 };

export type GuardedHtml = { ok: true; html: string; depth: number; elements: number } | { ok: false; reason: string };

/** Dropped with their content. */
const DROPPED = new Set(["script", "style", "noscript", "template", "svg"]);
/** Kept, but their content is text to the parser, not tags. */
const RAW_TEXT = new Set(["title", "textarea", "xmp"]);
const VOID = new Set([
  "area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "image", "img", "input", "keygen", "link",
  "meta", "param", "source", "track", "wbr",
]);

// Tags the parser (htmlparser2, under linkedom) closes when another tag opens, so unclosed <p> or <li> do not nest.
const P = ["p"];
const IMPLIED_CLOSE = new Map<string, Set<string>>([
  ["tr", new Set(["tr", "th", "td"])],
  ["th", new Set(["th"])],
  ["td", new Set(["thead", "th", "td"])],
  ["li", new Set(["li"])],
  ["option", new Set(["option"])],
  ["optgroup", new Set(["optgroup", "option"])],
  ["dd", new Set(["dd", "dt"])],
  ["dt", new Set(["dd", "dt"])],
  ["rt", new Set(["rt", "rp"])],
  ["rp", new Set(["rt", "rp"])],
  ["tbody", new Set(["thead", "tbody"])],
  ["tfoot", new Set(["thead", "tbody"])],
  ...[
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset",
    "figcaption", "figure", "footer", "form", "header", "hr", "main", "nav", "ol", "pre", "section", "table", "ul",
  ].map((tag): [string, Set<string>] => [tag, new Set(P)]),
]);

const NAME_CHAR = /[^\s/>]/;

function isLetter(char: string | undefined): boolean {
  return char !== undefined && /[a-zA-Z]/.test(char);
}

/** The index just past the `>` that ends a tag, skipping quoted attribute values. -1 if the tag never ends. */
function tagEnd(html: string, from: number): number {
  for (let index = from; index < html.length; index += 1) {
    const char = html[index];
    if (char === ">") return index + 1;
    if (char !== "=") continue;
    // Like the parser, a quote only starts a value right after `=`.
    let value = index + 1;
    while (value < html.length && /\s/.test(html[value])) value += 1;
    const quote = html[value];
    if (quote !== '"' && quote !== "'") continue;
    const close = html.indexOf(quote, value + 1);
    if (close === -1) return -1;
    index = close;
  }
  return -1;
}

function readName(html: string, from: number): { name: string; end: number } {
  let end = from;
  while (end < html.length && NAME_CHAR.test(html[end])) end += 1;
  return { name: html.slice(from, end).toLowerCase(), end };
}

/** Where `</name` starts at or after `from`, any case. -1 if never. */
function closingTag(html: string, name: string, from: number): number {
  const pattern = new RegExp(`</${name}[\\s/>]`, "gi");
  pattern.lastIndex = from;
  return pattern.exec(html)?.index ?? -1;
}

function formatChars(chars: number): string {
  return `${Math.round(chars / 100_000) / 10} MB`;
}

export function guardHtml(html: string, limits: HtmlLimits = READABILITY_LIMITS): GuardedHtml {
  const kept: string[] = [];
  const stack: string[] = [];
  let keptChars = 0;
  let copyFrom = 0;
  let depth = 0;
  let elements = 0;
  let index = 0;

  const keep = (end: number) => {
    kept.push(html.slice(copyFrom, end));
    keptChars += end - copyFrom;
  };
  const drop = (start: number, resume: number) => {
    keep(start);
    copyFrom = resume;
  };
  const tooBig = () => keptChars + (index - copyFrom) > limits.maxChars;

  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open === -1) break;
    index = open;
    if (tooBig()) break;

    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      index = close === -1 ? html.length : close + 3;
      drop(open, index);
      continue;
    }
    if (html[open + 1] === "!" || html[open + 1] === "?") {
      const end = tagEnd(html, open + 2);
      index = end === -1 ? html.length : end;
      continue;
    }
    if (html[open + 1] === "/" && isLetter(html[open + 2])) {
      const { name, end: nameEnd } = readName(html, open + 2);
      const end = tagEnd(html, nameEnd);
      index = end === -1 ? html.length : end;
      const at = stack.lastIndexOf(name);
      if (at !== -1) stack.length = at;
      continue;
    }
    if (!isLetter(html[open + 1])) {
      index = open + 1;
      continue;
    }

    const { name, end: nameEnd } = readName(html, open + 1);
    const end = tagEnd(html, nameEnd);
    index = end === -1 ? html.length : end;
    elements += 1;
    if (elements > limits.maxElements) {
      return { ok: false, reason: `The page has over ${limits.maxElements.toLocaleString("en-US")} HTML elements.` };
    }

    if (DROPPED.has(name)) {
      const close = closingTag(html, name, index);
      const closeEnd = close === -1 ? -1 : tagEnd(html, close + 2 + name.length);
      index = closeEnd === -1 ? html.length : closeEnd;
      drop(open, index);
      continue;
    }
    if (RAW_TEXT.has(name)) {
      const close = closingTag(html, name, index);
      index = close === -1 ? html.length : close;
      continue;
    }
    if (VOID.has(name)) continue;

    const closes = IMPLIED_CLOSE.get(name);
    while (closes && stack.length > 0 && closes.has(stack[stack.length - 1])) stack.pop();
    stack.push(name);
    depth = Math.max(depth, stack.length);
    if (depth > limits.maxDepth) {
      return { ok: false, reason: `The page nests HTML tags over ${limits.maxDepth} deep.` };
    }
  }

  index = html.length;
  if (tooBig()) return { ok: false, reason: `The page has over ${formatChars(limits.maxChars)} of HTML, not counting scripts and styles.` };
  keep(html.length);
  return { ok: true, html: kept.join(""), depth, elements };
}
