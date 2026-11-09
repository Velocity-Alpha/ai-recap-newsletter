import { HTMLElement, NodeType, parse, type Node } from "node-html-parser";

/**
 * Turns an AI Recap issue email (the draft template HTML, or the copy received in a seed inbox) into the
 * `content_json` v2 object the website renders. No AI: it reads the IDs and structure that n8n's
 * "Build Clean HTML Email" node writes. `data-issue-id` names the issue; each story wrapper carries
 * `data-story-id` and `data-src-url`, which survive Mailgun's link tracking. Native drafts also put
 * `data-draft-id` next to `data-issue-id` (src/pipeline/draft/email-html.ts).
 */

export interface PublishedBullet {
  before: string;
  highlight: string;
  after: string;
}

export interface PublishedFeatureStory {
  story_id: number;
  url: string;
  headline: string;
  story_detail: string;
  bullets: PublishedBullet[];
}

export interface PublishedToolItem {
  story_id: number;
  url: string;
  link_text: string;
  detail: string;
}

export interface PublishedQuickHit {
  story_id: number;
  url: string;
  link_text: string;
  text: string;
}

/** Same keys, order, and types as the `content_json` n8n's Gmail Listen writes. */
export interface PublishedIssueContent {
  schemaVersion: 2;
  featured_image_url: string;
  title: string;
  date: string;
  issue_id: number;
  overview: { summary: string };
  headlines: PublishedFeatureStory[];
  research_and_analysis: PublishedFeatureStory[];
  tools: PublishedToolItem[];
  quick_hits: PublishedQuickHit[];
}

export interface SentEmailParseResult {
  content: PublishedIssueContent;
  /** Every `data-story-id` in the email, in order, once each. */
  storyIds: number[];
  /** Anything the parser could not read cleanly. Empty means the email matched the template. */
  problems: string[];
  /** The native draft this email was made from; null for n8n's emails, which carry no draft id. */
  draftId: number | null;
}

type SectionKey = "overview" | "headlines" | "research_and_analysis" | "tools" | "quick_hits";

const SECTION_LABELS: Record<string, SectionKey> = {
  "today's overview": "overview",
  "top stories": "headlines",
  "research & analysis": "research_and_analysis",
  "trending ai tools": "tools",
  "quick hits": "quick_hits",
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const EMOJI_PIECES =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}\u{E0020}-\u{E007F}‍︎️⃣]/gu;

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripEmoji(value: string): string {
  return collapse(value.replace(EMOJI_PIECES, ""));
}

function elementChildren(node: HTMLElement): HTMLElement[] {
  return node.childNodes.filter((child): child is HTMLElement => child.nodeType === NodeType.ELEMENT_NODE);
}

function textOf(node: Node): string {
  return collapse(node.text);
}

function sectionKeyFor(label: string): SectionKey | null {
  const normalized = stripEmoji(label).toLowerCase().replace(/[‘’]/g, "'");
  return SECTION_LABELS[normalized] ?? null;
}

function parseHeaderDate(text: string): string {
  const match = /briefing for\s+(?:[A-Za-z]+,\s+)?([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(text);
  if (!match) return "";
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return "";
  const date = new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
  if (date.getUTCDate() !== Number(match[2])) return "";
  return date.toISOString().slice(0, 10);
}

function positiveId(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function storyId(element: HTMLElement): number {
  return Number.parseInt(element.getAttribute("data-story-id") ?? "", 10);
}

function storyUrl(element: HTMLElement): string {
  return (element.getAttribute("data-src-url") ?? "").trim();
}

function parseBullet(table: HTMLElement): PublishedBullet {
  const cells = table.querySelectorAll("td");
  const cell = cells[cells.length - 1];
  if (!cell) return { before: "", highlight: "", after: "" };

  let before = "";
  let highlight = "";
  let after = "";
  for (const child of cell.childNodes) {
    const isHighlight =
      child.nodeType === NodeType.ELEMENT_NODE && (child as HTMLElement).tagName === "STRONG";
    if (isHighlight && !highlight) {
      highlight = child.text;
    } else if (highlight) {
      after += child.text;
    } else {
      before += child.text;
    }
  }
  return { before: collapse(before), highlight: collapse(highlight), after: collapse(after) };
}

function parseFeatureStory(element: HTMLElement): PublishedFeatureStory {
  const texts: string[] = [];
  let bullets: PublishedBullet[] = [];

  for (const child of elementChildren(element)) {
    if (child.querySelector("table")) {
      bullets = child.querySelectorAll("table").map(parseBullet);
    } else if (!child.querySelector("a")) {
      texts.push(textOf(child));
    }
  }

  return {
    story_id: storyId(element),
    url: storyUrl(element),
    headline: texts[0] ?? "",
    story_detail: texts[1] ?? "",
    bullets,
  };
}

/** Link text, then the rest of the line (tools add " - " before their detail). */
function splitLinkLine(element: HTMLElement, separator: RegExp): { linkText: string; rest: string } {
  const link = element.querySelector("a");
  if (!link) return { linkText: "", rest: textOf(element) };
  const linkText = textOf(link);
  const line = textOf(link.parentNode ?? element);
  const at = line.indexOf(linkText);
  const rest = at >= 0 ? line.slice(at + linkText.length) : "";
  return { linkText, rest: collapse(collapse(rest).replace(separator, "")) };
}

export function parseSentEmail(html: string): SentEmailParseResult | null {
  if (!html) return null;
  const root = parse(html, { comment: false });
  const issueElement = root.querySelector("[data-issue-id]");
  if (!issueElement) return null;

  const issueId = Number.parseInt(issueElement.getAttribute("data-issue-id") ?? "", 10);
  if (!Number.isSafeInteger(issueId) || issueId <= 0) return null;

  const problems: string[] = [];
  const [header, ...blocks] = elementChildren(issueElement);
  const headerLines = header ? elementChildren(header) : [];
  const greeting = headerLines.find((line) => /briefing for/i.test(line.text));
  const titleLine = greeting ? headerLines[headerLines.indexOf(greeting) - 1] : headerLines[1];

  const title = titleLine ? stripEmoji(titleLine.text) : "";
  if (!title) problems.push("No title found in the email header.");
  const date = greeting ? parseHeaderDate(textOf(greeting)) : "";
  if (!date) problems.push("No issue date found in the email header.");

  const image = issueElement.querySelector("img");
  const content: PublishedIssueContent = {
    schemaVersion: 2,
    featured_image_url: (image?.getAttribute("src") ?? "").trim(),
    title,
    date,
    issue_id: issueId,
    overview: { summary: "" },
    headlines: [],
    research_and_analysis: [],
    tools: [],
    quick_hits: [],
  };

  for (const block of blocks) {
    const [labelElement, ...rest] = elementChildren(block);
    if (!labelElement) continue;
    const key = sectionKeyFor(labelElement.text);
    const stories = block.querySelectorAll("[data-story-id]");

    if (key === "overview") {
      content.overview.summary = rest.map(textOf).join(" ").trim();
    } else if (key === "headlines" || key === "research_and_analysis") {
      content[key] = stories.map(parseFeatureStory);
    } else if (key === "tools") {
      content.tools = stories.map((element) => {
        const { linkText, rest: detail } = splitLinkLine(element.querySelector("td:last-child") ?? element, /^[-–—]\s*/);
        return { story_id: storyId(element), url: storyUrl(element), link_text: linkText, detail };
      });
    } else if (key === "quick_hits") {
      content.quick_hits = stories.map((element) => {
        const { linkText, rest: text } = splitLinkLine(element, /^$/);
        return { story_id: storyId(element), url: storyUrl(element), link_text: linkText, text };
      });
    } else if (stories.length > 0) {
      problems.push(
        `Unknown section "${stripEmoji(labelElement.text)}" holds stories ${stories.map(storyId).join(", ")}.`
      );
    }
  }

  if (!content.overview.summary) problems.push("No overview summary found.");

  const storyIds = Array.from(
    new Set(issueElement.querySelectorAll("[data-story-id]").map(storyId).filter(Number.isSafeInteger))
  );

  return { content, storyIds, problems, draftId: positiveId(issueElement.getAttribute("data-draft-id")) };
}
