/**
 * The two non-email sources. Each builds one text block for the extraction model, as n8n did.
 * Fix: Hugging Face now honours the cutoff, so papers already ingested are not read again every day.
 */

export const PRODUCT_HUNT_FEED_URL = "https://www.producthunt.com/feed?category=artificial-intelligence";
export const HUGGING_FACE_PAPERS_URL = "https://huggingface.co/papers";

const PRODUCT_LIMIT = 12;
const PAPER_LIMIT = 5;
const TORONTO_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" });

export interface FeedText {
  text: string;
  count: number;
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? match[1].trim() : "";
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function buildProductHuntText(
  feed: string,
  options: { cutoff: Date; now: Date; targetDate: string },
): FeedText {
  const seen = new Set<string>();
  const products: string[] = [];

  for (const [block] of feed.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    if (products.length >= PRODUCT_LIMIT) break;
    const name = decodeEntities(tag(block, "title"));
    const link =
      block.match(/<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"/i)?.[1] ??
      block.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ??
      "";
    const url = decodeEntities(link);
    const published = new Date(tag(block, "published"));
    if (!name || !url || Number.isNaN(published.getTime())) continue;
    if (published < options.cutoff || published > options.now || seen.has(url)) continue;
    seen.add(url);

    const content = decodeEntities(tag(block, "content"));
    const tagline = decodeEntities(stripTags(content.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ""));
    products.push(
      [
        `## Product ${products.length + 1}`,
        `Name: ${name}`,
        `Tagline: ${tagline}`,
        `Product Hunt URL: ${url}`,
        `Published at: ${TORONTO_DATE.format(published)}`,
      ].join("\n"),
    );
  }

  const header = ["Source: Product Hunt AI category feed", "", `Target date: ${options.targetDate}`];
  return { text: [...header, "", products.join("\n\n")].join("\n"), count: products.length };
}

interface DailyPaper {
  title?: string;
  summary?: string;
  publishedAt?: string;
  organization?: { fullname?: string; name?: string };
  paper?: {
    id?: string;
    title?: string;
    summary?: string;
    ai_summary?: string;
    submittedOnDailyAt?: string;
    upvotes?: number;
    authors?: Array<{ name?: string }>;
  };
}

export function buildHuggingFaceText(page: string, options: { cutoff: Date; targetDate: string }): FeedText {
  const match = page.match(/data-target="DailyPapers"[^>]*data-props="([^"]+)"/);
  let papers: DailyPaper[] | undefined;
  try {
    papers = match ? (JSON.parse(decodeEntities(match[1])) as { dailyPapers?: DailyPaper[] }).dailyPapers : undefined;
  } catch {
    papers = undefined;
  }
  if (!Array.isArray(papers)) throw new Error("Hugging Face page has no daily paper list.");

  const fresh = papers
    .filter((entry) => entry.paper?.id)
    .filter((entry) => {
      const added = new Date(entry.paper?.submittedOnDailyAt ?? entry.publishedAt ?? "");
      return !Number.isNaN(added.getTime()) && added > options.cutoff;
    })
    .slice(0, PAPER_LIMIT);

  const blocks = fresh.map((entry, index) => {
    const paper = entry.paper!;
    const authors = (paper.authors ?? []).map((author) => author.name).filter(Boolean).join(", ");
    return [
      `## Paper ${index + 1}`,
      `Title: ${paper.title ?? entry.title ?? ""}`,
      `URL: https://huggingface.co/papers/${paper.id}`,
      `Organization: ${entry.organization?.fullname ?? entry.organization?.name ?? ""}`,
      `Authors: ${authors}`,
      `Upvotes: ${paper.upvotes ?? 0}`,
      `Short summary: ${paper.ai_summary ?? ""}`,
      `Abstract: ${paper.summary ?? entry.summary ?? ""}`,
    ].join("\n");
  });

  const header = ["Source: Hugging Face daily papers", "", `Target date: ${options.targetDate}`];
  return { text: [...header, "", blocks.join("\n\n")].join("\n"), count: blocks.length };
}
