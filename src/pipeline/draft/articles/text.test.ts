import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import { htmlToText, markdownToText, normalizeText } from "@/src/pipeline/draft/articles/text";

describe("htmlToText", () => {
  it("keeps paragraphs, headings and list items on their own lines, and drops scripts and styles", () => {
    const { document } = parseHTML(`<html><body><article>
      <h2>A made-up   heading</h2>
      <p>First <b>pretend</b> paragraph<br>with a break.</p>
      <script>window.track()</script><style>p { color: red }</style>
      <ul><li>One toy point</li><li>Another toy point</li></ul>
      <table><tr><td>cell a</td><td>cell b</td></tr></table>
    </article></body></html>`);

    expect(htmlToText(document.querySelector("article")!)).toBe(
      "A made-up heading\n\nFirst pretend paragraph\nwith a break.\n\n- One toy point\n- Another toy point\n\ncell a cell b",
    );
  });
});

describe("markdownToText", () => {
  it("keeps link text and drops images, badges, HTML, link targets and emphasis marks", () => {
    const markdown = [
      "---",
      "license: mit",
      "tags: [toy]",
      "---",
      '<p align="center"><img src="logo.png"></p>',
      "[![build](https://img.example.com/badge.svg)](https://ci.example.com)",
      "# Toy Model",
      "",
      "A **pretend** model from [the toy lab](https://lab.example.com) with `code` and _style_.",
      "![diagram](https://img.example.com/d.png)",
      "<!-- hidden -->",
    ].join("\n");

    expect(markdownToText(markdown)).toBe("Toy Model\n\nA pretend model from the toy lab with code and style.");
  });
});

describe("normalizeText", () => {
  it("trims lines, collapses spaces and keeps at most one blank line", () => {
    expect(normalizeText("  a  b \r\n\n\n\n c\t\td  ")).toBe("a b\n\nc d");
  });
});
