import { parse } from "node-html-parser";

import { htmlToText } from "@/src/pipeline/ingest/email-text";

/**
 * Reads a beehiiv publication's public website: the post list from `sitemap.xml`, and each post's
 * schema.org Article data and `#content-blocks` element. Pure functions; the caller fetches.
 */

export interface SitemapPost {
  url: string;
  /** YYYY-MM-DD, the UTC day the post last changed (not when it was published). */
  lastmod: string | null;
}

export interface PostMeta {
  publishedAt: Date;
  free: boolean;
}

function xmlValue(raw: string): string {
  return raw
    .trim()
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .trim()
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function isPostUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith("/p/");
  } catch {
    return false;
  }
}

export function listSitemapPosts(xml: string): SitemapPost[] {
  const posts: SitemapPost[] = [];
  for (const [, entry] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = entry.match(/<loc>([\s\S]*?)<\/loc>/)?.[1];
    if (!loc) continue;
    const url = xmlValue(loc);
    if (!isPostUrl(url)) continue;
    const lastmod = entry.match(/<lastmod>([\s\S]*?)<\/lastmod>/)?.[1];
    posts.push({ url, lastmod: lastmod ? (xmlValue(lastmod).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null) : null });
  }
  return posts;
}

function findArticle(html: string): Record<string, unknown> | null {
  for (const script of parse(html).querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      // rawText: the decoded text would turn an escaped `&quot;` in a headline into a bare quote.
      data = JSON.parse(script.rawText);
    } catch {
      continue;
    }
    if (data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>)["@type"] === "Article") {
      return data as Record<string, unknown>;
    }
  }
  return null;
}

export function readPostMeta(html: string): PostMeta {
  const article = findArticle(html);
  if (!article) throw new Error("beehiiv post has no Article data.");

  const publishedAt = new Date(typeof article.datePublished === "string" ? article.datePublished : NaN);
  if (Number.isNaN(publishedAt.getTime())) throw new Error("beehiiv post has no valid datePublished.");

  // beehiiv writes the flag as the string "True" or "False". Only an explicit false means paid.
  const access = article.isAccessibleForFree;
  const free = !(access === false || (typeof access === "string" && access.toLowerCase() === "false"));
  return { publishedAt, free };
}

export function readPostText(html: string): string {
  const content = parse(html, { comment: false }).getElementById("content-blocks");
  if (!content) throw new Error("beehiiv post has no #content-blocks element.");
  const text = htmlToText(content.outerHTML);
  if (!text) throw new Error("beehiiv post has no text.");
  return text;
}
