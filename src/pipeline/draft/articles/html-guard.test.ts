import { describe, expect, it } from "vitest";

import { hostileHtml as HOSTILE } from "@/src/pipeline/draft/articles/fake-web.fixture";
import { guardHtml, READABILITY_LIMITS } from "@/src/pipeline/draft/articles/html-guard";

function page(body: string): string {
  return `<!DOCTYPE html><html><head><title>A pretend page</title></head><body>${body}</body></html>`;
}

describe("guardHtml", () => {
  it("passes a normal page through, with its depth and element count", () => {
    const html = page("<main><article><h1>Toy arm</h1><p>One pretend paragraph.</p><p>Another <a href='/x'>link</a>.</p></article></main>");

    const result = guardHtml(html);

    // html > body > main > article > p > a; ten tags with head and title.
    expect(result).toEqual({ ok: true, html, depth: 6, elements: 10 });
  });

  it("refuses tags nested over 400 deep, in milliseconds", () => {
    expect(guardHtml(HOSTILE.deep(READABILITY_LIMITS.maxDepth - 3)).ok).toBe(true);

    const started = performance.now();
    const result = guardHtml(HOSTILE.deep(4_000));

    expect(result).toEqual({ ok: false, reason: "The page nests HTML tags over 400 deep." });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("refuses a page of over 30,000 elements, in milliseconds", () => {
    const started = performance.now();
    const result = guardHtml(HOSTILE.tiny(600_000));

    expect(result).toEqual({ ok: false, reason: "The page has over 30,000 HTML elements." });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("refuses over 1.5 MB of HTML once scripts, styles, SVG and comments are dropped", () => {
    const text = `<p>${"Pretend words. ".repeat(110_000)}</p>`;
    expect(guardHtml(page(text))).toEqual({ ok: false, reason: "The page has over 1.5 MB of HTML, not counting scripts and styles." });

    const bloated = page(`<script>${"var pretend = 1;".repeat(200_000)}</script><p>Short.</p>`);
    expect(guardHtml(bloated)).toMatchObject({ ok: true, html: page("<p>Short.</p>") });
  });

  it("drops scripts, styles, SVG, templates and comments with their content, and their tags do not count", () => {
    const html = page(
      [
        "<script>if (a < b) document.write('<div><div><div>')</script>",
        "<style>p > a { color: red }</style>",
        "<svg><g><g><path d='M0 0'/></g></g></svg>",
        "<template><div><div></div></div></template>",
        "<noscript><img src='/pixel'></noscript>",
        "<!-- <div><div><div> -->",
        "<p>Kept text.</p>",
      ].join(""),
    );

    const result = guardHtml(html, { ...READABILITY_LIMITS, maxDepth: 3 });

    expect(result).toMatchObject({ ok: true, html: page("<p>Kept text.</p>"), depth: 3 });
  });

  it("does not count unclosed <p>, <li> or table cells as nesting, as the parser closes them", () => {
    const html = page(`<ul>${"<li>Pretend item".repeat(500)}</ul>${"<p>Pretend paragraph".repeat(500)}<table>${"<tr><td>a<td>b".repeat(500)}</table>`);

    const result = guardHtml(html);

    expect(result).toMatchObject({ ok: true, depth: 5 });
  });

  it("reads quoted attributes that hold > or <, and skips stray < in text", () => {
    const html = page(`<div title="a > b" data-x='<div><div>'><p>1 < 2 and 3 <4</p></div>`);

    expect(guardHtml(html, { ...READABILITY_LIMITS, maxDepth: 4 })).toMatchObject({ ok: true, depth: 4, elements: 6 });
  });

  it("matches close tags in any case, and ignores a close tag with no open one", () => {
    const html = page(`${"<DIV><Span>x</SPAN></div></em>".repeat(50)}`);

    expect(guardHtml(html)).toMatchObject({ ok: true, depth: 4 });
  });
});
