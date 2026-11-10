import { describe, expect, it } from "vitest";

import { listSitemapPosts, readPostMeta, readPostText } from "@/src/pipeline/ingest/beehiiv-site";

describe("listSitemapPosts", () => {
  const urlset = (...urls: string[]) => `<?xml version="1.0"?><urlset>${urls.join("")}</urlset>`;

  it("lists only URLs under /p/", () => {
    const xml = urlset(
      "<url><loc>https://news.example.org/</loc><lastmod>2026-11-10</lastmod></url>",
      "<url><loc>https://news.example.org/p/first-post</loc><lastmod>2026-11-10</lastmod></url>",
      "<url><loc>https://news.example.org/archive</loc></url>",
    );
    expect(listSitemapPosts(xml).map((post) => post.url)).toEqual(["https://news.example.org/p/first-post"]);
  });

  it("gives a post without lastmod a null lastmod", () => {
    expect(listSitemapPosts(urlset("<url><loc>https://news.example.org/p/x</loc></url>"))).toEqual([
      { url: "https://news.example.org/p/x", lastmod: null },
    ]);
  });

  it("decodes XML entities in loc", () => {
    expect(listSitemapPosts(urlset("<url><loc>https://news.example.org/p/a&amp;b</loc></url>"))[0].url).toBe(
      "https://news.example.org/p/a&b",
    );
  });

  it("unwraps CDATA in loc and lastmod", () => {
    const xml = urlset("<url><loc><![CDATA[https://news.example.org/p/wrapped]]></loc><lastmod><![CDATA[2026-11-09]]></lastmod></url>");
    expect(listSitemapPosts(xml)).toEqual([{ url: "https://news.example.org/p/wrapped", lastmod: "2026-11-09" }]);
  });
});

function page(ld: string[], body = '<div id="content-blocks"><p>Intro <a href="https://example.org/x">Story X</a></p></div>') {
  const blocks = ld.map((json) => `<script type="application/ld+json">${json}</script>`).join("");
  return `<html><head>${blocks}<style>.a{}</style></head><body><script>var x=1;</script>${body}<footer>Footer</footer></body></html>`;
}

const article = (free?: string) =>
  `{"@type":"Article","headline":"A post","datePublished":"2026-11-10T03:01:00.000Z"${free === undefined ? "" : `,"isAccessibleForFree":${free}`}}`;

describe("readPostMeta", () => {
  it("reads the Article date and free flag", () => {
    expect(readPostMeta(page([article('"True"')]))).toEqual({ publishedAt: new Date("2026-11-10T03:01:00.000Z"), free: true });
  });

  it("skips ld+json blocks that are not an Article or not valid JSON", () => {
    const meta = readPostMeta(page(['{"@type":"BreadcrumbList"}', "{not json", article(), '{"@type":"FAQPage"}']));
    expect(meta.publishedAt).toEqual(new Date("2026-11-10T03:01:00.000Z"));
  });

  it("reads the script's raw text, so entities in a headline do not break the JSON", () => {
    const html = page(['{"@type":"Article","headline":"Say &quot;hi&quot; &amp; go","datePublished":"2026-11-10T03:01:00Z"}']);
    expect(readPostMeta(html).free).toBe(true);
  });

  it("treats only an explicit false as paid", () => {
    expect(readPostMeta(page([article('"False"')])).free).toBe(false);
    expect(readPostMeta(page([article('"false"')])).free).toBe(false);
    expect(readPostMeta(page([article('"FALSE"')])).free).toBe(false);
    expect(readPostMeta(page([article("false")])).free).toBe(false);
    for (const free of [undefined, "null", "true", '"True"']) expect(readPostMeta(page([article(free)])).free).toBe(true);
  });

  it("throws clear errors when the Article or its date is missing", () => {
    expect(() => readPostMeta(page(['{"@type":"FAQPage"}']))).toThrow("beehiiv post has no Article data.");
    expect(() => readPostMeta(page([`[${article()}]`]))).toThrow("beehiiv post has no Article data.");
    expect(() => readPostMeta(page(['{"@type":"Article","datePublished":"soon"}']))).toThrow("beehiiv post has no valid datePublished.");
  });
});

describe("readPostText", () => {
  it("reads only the content-blocks element, with links", () => {
    const text = readPostText(page([]));
    expect(text).toContain("Intro [Story X](https://example.org/x)");
    expect(text).not.toContain("Footer");
    expect(text).not.toContain("var x");
  });

  it("throws when the body is missing or empty", () => {
    expect(() => readPostText(page([], "<div>no blocks</div>"))).toThrow("beehiiv post has no #content-blocks element.");
    expect(() => readPostText(page([], '<div id="content-blocks"> </div>'))).toThrow("beehiiv post has no text.");
  });
});
