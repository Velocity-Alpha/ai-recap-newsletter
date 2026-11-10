import { describe, expect, it } from "vitest";

import { listSitemapPosts, readBeehiivPost } from "@/src/pipeline/ingest/beehiiv-site";

describe("listSitemapPosts", () => {
  it("lists only /p/ posts, with lastmod or null, and decodes entities", () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://news.example.org/</loc><lastmod>2026-11-10</lastmod></url>
      <url><loc>https://news.example.org/p/first-post</loc><lastmod>2026-11-10</lastmod></url>
      <url><loc>https://news.example.org/p/a&amp;b</loc></url>
      <url><loc>https://news.example.org/archive</loc></url>
    </urlset>`;
    expect(listSitemapPosts(xml)).toEqual([
      { url: "https://news.example.org/p/first-post", lastmod: "2026-11-10" },
      { url: "https://news.example.org/p/a&b", lastmod: null },
    ]);
  });
});

function page(ld: string[], body = '<div id="content-blocks"><p>Intro <a href="https://example.org/x">Story X</a></p></div>') {
  const blocks = ld.map((json) => `<script type="application/ld+json">${json}</script>`).join("");
  return `<html><head>${blocks}<style>.a{}</style></head><body><script>var x=1;</script>${body}<footer>Footer</footer></body></html>`;
}

const ARTICLE = '{"@type":"Article","datePublished":"2026-11-10T03:01:00.000Z","isAccessibleForFree":"True"}';

describe("readBeehiivPost", () => {
  it("reads the Article date, free flag and the content-blocks text only", () => {
    const html = page(['{"@type":"BreadcrumbList"}', "{not json", ARTICLE, '{"@type":"FAQPage"}']);
    const post = readBeehiivPost(html);
    expect(post.publishedAt).toEqual(new Date("2026-11-10T03:01:00.000Z"));
    expect(post.free).toBe(true);
    expect(post.text).toContain("Intro [Story X](https://example.org/x)");
    expect(post.text).not.toContain("Footer");
    expect(post.text).not.toContain("var x");
  });

  it("reads paid posts, boolean flags, a missing flag, arrays and @graph", () => {
    expect(readBeehiivPost(page([ARTICLE.replace('"True"', '"False"')])).free).toBe(false);
    expect(readBeehiivPost(page([ARTICLE.replace('"True"', "false")])).free).toBe(false);
    expect(readBeehiivPost(page(['{"@type":"Article","datePublished":"2026-11-10T03:01:00Z"}'])).free).toBe(true);
    expect(readBeehiivPost(page([`{"@graph":[${ARTICLE}]}`])).free).toBe(true);
    expect(readBeehiivPost(page([`[${ARTICLE}]`])).free).toBe(true);
  });

  it("throws clear errors when a part is missing", () => {
    expect(() => readBeehiivPost(page(['{"@type":"FAQPage"}']))).toThrow("beehiiv post has no Article data.");
    expect(() => readBeehiivPost(page(['{"@type":"Article","datePublished":"soon"}']))).toThrow(
      "beehiiv post has no valid datePublished.",
    );
    expect(() => readBeehiivPost(page([ARTICLE], "<div>no blocks</div>"))).toThrow("beehiiv post has no #content-blocks element.");
    expect(() => readBeehiivPost(page([ARTICLE], '<div id="content-blocks"> </div>'))).toThrow("beehiiv post has no text.");
  });
});
