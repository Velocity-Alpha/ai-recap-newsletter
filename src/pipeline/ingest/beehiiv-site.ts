import { parse } from "node-html-parser";

import { htmlToText } from "@/src/pipeline/ingest/email-text";

/**
 * Reads a beehiiv publication's public website: the post list from `sitemap.xml` and each post from its
 * schema.org Article data and its `#content-blocks` element. Pure functions; the caller fetches.
 */

export interface SitemapPost {
  url: string;
  /** YYYY-MM-DD, the day the post last changed (not when it was published). */
  lastmod: string | null;
}

export interface BeehiivPost {
  publishedAt: Date;
  free: boolean;
  text: string;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function listSitemapPosts(xml: string): SitemapPost[] {
  const posts: SitemapPost[] = [];
  for (const [, entry] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = entry.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    const url = decodeXml(loc);
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      continue;
    }
    if (!path.startsWith("/p/")) continue;
    const lastmod = entry.match(/<lastmod>\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
    posts.push({ url, lastmod });
  }
  return posts;
}

type JsonObject = Record<string, unknown>;

function isArticle(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object") return false;
  const type = (value as JsonObject)["@type"];
  return type === "Article" || (Array.isArray(type) && type.includes("Article"));
}

function findArticle(root: ReturnType<typeof parse>): JsonObject | null {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(script.text);
    } catch {
      continue;
    }
    const graph = data && typeof data === "object" && !Array.isArray(data) ? (data as JsonObject)["@graph"] : undefined;
    const candidates = Array.isArray(data) ? data : Array.isArray(graph) ? graph : [data];
    const article = candidates.find(isArticle);
    if (article) return article;
  }
  return null;
}

export function readBeehiivPost(html: string): BeehiivPost {
  const root = parse(html, { comment: false });
  const article = findArticle(root);
  if (!article) throw new Error("beehiiv post has no Article data.");

  const publishedAt = new Date(typeof article.datePublished === "string" ? article.datePublished : NaN);
  if (Number.isNaN(publishedAt.getTime())) throw new Error("beehiiv post has no valid datePublished.");

  // beehiiv writes the flag as the string "True" or "False".
  const access = article.isAccessibleForFree;
  const free = access === undefined || access === true || (typeof access === "string" && access.toLowerCase() === "true");

  const content = root.getElementById("content-blocks");
  if (!content) throw new Error("beehiiv post has no #content-blocks element.");
  const text = htmlToText(content.outerHTML);
  if (!text) throw new Error("beehiiv post has no text.");

  return { publishedAt, free, text };
}
