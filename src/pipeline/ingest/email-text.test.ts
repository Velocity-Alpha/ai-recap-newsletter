import { describe, expect, it } from "vitest";

import { htmlToText } from "@/src/pipeline/ingest/email-text";

describe("htmlToText", () => {
  it("keeps headings, paragraphs and links, and drops styles, scripts and images", () => {
    const html = `<html><head><style>p{color:red}</style><title>x</title></head><body>
      <h2 style="font-size:20px">Top story</h2>
      <p>OpenAI shipped <a href="https://openai.com/index/lifeval">LifeVal</a> today.<img src="a.png"></p>
      <script>track()</script>
      <table><tr><td>Cell one</td><td>Cell&nbsp;two &amp; more</td></tr></table>
      <ul><li>First</li><li><a href="https://github.com/org/repo">Repo</a></li></ul>
      <a href="https://example.org/empty"> </a>
    </body></html>`;

    expect(htmlToText(html)).toBe(
      [
        "Top story",
        "",
        "OpenAI shipped [LifeVal](https://openai.com/index/lifeval) today.",
        "",
        "Cell one Cell two & more",
        "",
        "- First",
        "- [Repo](https://github.com/org/repo)",
      ].join("\n"),
    );
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});
