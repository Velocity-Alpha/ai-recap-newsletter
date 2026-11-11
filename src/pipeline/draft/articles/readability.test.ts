import { describe, expect, it, vi } from "vitest";

import { hostileHtml, parseHere } from "@/src/pipeline/draft/articles/fake-web.fixture";
import { FetchFailure, type FetchLike } from "@/src/pipeline/draft/articles/http";
import { readWithReadability } from "@/src/pipeline/draft/articles/readability";
import { MethodError, READER_USER_AGENT, type MethodContext } from "@/src/pipeline/draft/articles/types";

const PARAGRAPHS = [
  "The pretend robotics lab said on Monday that its toy arm can now fold synthetic towels in under ten seconds, a made-up record.",
  "Engineers trained the imaginary model on a fictional dataset of two million simulated folds, according to the invented report.",
  "The sample company plans to ship a placeholder kit to fake customers next spring, with a price that nobody has announced yet.",
  "Critics in this story are also invented, and they say the demo hides how often the toy arm drops the pretend towels on the floor.",
];

const ARTICLE_PAGE = `<!DOCTYPE html><html><head><title>Toy arm folds towels</title></head><body>
  <header><nav><a href="/">Home</a> <a href="/news">News</a> <a href="/about">About the fake site</a></nav></header>
  <main><article>
    <h1>Toy arm folds towels</h1>
    ${PARAGRAPHS.map((text) => `<p>${text}</p>`).join("\n")}
  </article></main>
  <aside class="related"><h3>Related</h3><ul><li><a href="/x">Another pretend story</a></li></ul></aside>
  <footer>Copyright fake site. Newsletter sign-up form.</footer>
</body></html>`;

function respond(body: string | Uint8Array<ArrayBuffer>, contentType = "text/html; charset=utf-8", status = 200) {
  return vi.fn<FetchLike>(async () => new Response(body, { status, headers: { "content-type": contentType } }));
}

const context = (fetch: FetchLike) => ({ fetch, signal: new AbortController().signal, parse: parseHere });

describe("readWithReadability", () => {
  it("returns the page's main text without menus, related links or the footer", async () => {
    const fetch = respond(ARTICLE_PAGE);

    const result = await readWithReadability("https://news.example.com/toy-arm", context(fetch));

    expect(result.httpStatus).toBe(200);
    expect(result.finalUrl).toBe("https://news.example.com/toy-arm");
    for (const paragraph of PARAGRAPHS) expect(result.text).toContain(paragraph);
    expect(result.text).toContain(`${PARAGRAPHS[0]}\n\n${PARAGRAPHS[1]}`);
    expect(result.text).not.toContain("About the fake site");
    expect(result.text).not.toContain("Another pretend story");
    expect(result.text).not.toContain("Newsletter sign-up");
  });

  it("asks for the page like a desktop Chrome visit, HTML first, also Markdown and PDF", async () => {
    const fetch = respond(ARTICLE_PAGE);
    await readWithReadability("https://news.example.com/toy-arm", context(fetch));
    const headers = fetch.mock.calls[0][1].headers;
    expect(headers["User-Agent"]).toMatch(/^Mozilla\/5\.0 \(Macintosh; .+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
    expect(headers["User-Agent"]).not.toBe(READER_USER_AGENT);
    expect(headers.Accept).toMatch(/^text\/html,/);
    expect(headers.Accept).toContain("text/markdown");
    expect(headers.Accept).toContain("application/pdf");
    expect(headers).toMatchObject({
      "Accept-Language": expect.stringContaining("en-US"),
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    });
  });

  it("passes an error status on without parsing the page", async () => {
    const result = await readWithReadability("https://news.example.com/x", context(respond("<p>Forbidden</p>", "text/html", 403)));
    expect(result).toEqual({ text: "", httpStatus: 403, finalUrl: "https://news.example.com/x" });
  });

  it("uses a plain-text page as it is", async () => {
    const result = await readWithReadability("https://news.example.com/notes.txt", context(respond("  Plain pretend notes.  ", "text/plain")));
    expect(result.text).toBe("Plain pretend notes.");
  });

  it("fails on an image or other non-page type from its content type, without downloading it, so the next method can try", async () => {
    const pulls = vi.fn();
    const cancel = vi.fn();
    const image = new ReadableStream<Uint8Array>({ pull: pulls, cancel }, { highWaterMark: 0 });
    const fetch = vi.fn<FetchLike>(async () => new Response(image, { headers: { "content-type": "image/png" } }));

    const error = await readWithReadability("https://news.example.com/chart.png", context(fetch)).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(FetchFailure);
    expect(error).toMatchObject({ kind: "wrong_type", message: "Not an HTML page (image/png)." });
    expect(pulls).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    // A wrong type is not retried.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["tags nested 4,000 deep", hostileHtml.deep(4_000), "The page nests HTML tags over 400 deep."],
    ["600,000 tiny elements", hostileHtml.tiny(600_000), "The page has over 30,000 HTML elements."],
  ])("refuses a hostile page (%s) without parsing it, in well under the fetch timeout", async (_kind, html, reason) => {
    const parse = vi.fn<MethodContext["parse"]>(parseHere);
    const started = performance.now();

    const error = await readWithReadability("https://news.example.com/x", { ...context(respond(html)), parse }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MethodError);
    expect(error).toMatchObject({ status: "failed", message: reason });
    expect(parse).not.toHaveBeenCalled();
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("parses the page with scripts and comments already dropped", async () => {
    const parse = vi.fn<MethodContext["parse"]>(parseHere);

    await readWithReadability("https://news.example.com/x", { ...context(respond(ARTICLE_PAGE.replace("<main>", "<script>var pretend = '<p>';</script><!-- x --><main>"))), parse });

    expect(parse).toHaveBeenCalledWith({ kind: "readable", html: ARTICLE_PAGE }, expect.any(AbortSignal));
  });
});
