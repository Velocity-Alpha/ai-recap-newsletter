import { describe, expect, it, vi } from "vitest";

import { fakeWeb, hang, hostileHtml, htmlPage, jinaAnswer, jinaError, jinaUrl, pdfDocument, pdfResponse, prose, rawHtml } from "@/src/pipeline/draft/articles/fake-web.fixture";
import { parseInThisThread, type TextParser } from "@/src/pipeline/draft/articles/text-worker";
import { HostLimiter } from "@/src/pipeline/draft/articles/http";
import { DEFAULT_LIMITS, MAX_TEXT_CHARS, readArticle } from "@/src/pipeline/draft/articles/read-article";

const STORY = "https://news.example.com/toy-arm";
const PAPER_ABS = "https://arxiv.org/abs/2401.01234";
const PAPER_HTML = "https://arxiv.org/html/2401.01234";

function paperPage(text: string) {
  return () =>
    new Response(`<html><body><article class="ltx_document"><h1 class="ltx_title">Pretend paper</h1><p>${text}</p></article></body></html>`, {
      headers: { "content-type": "text/html" },
    });
}

describe("readArticle", () => {
  it("gives each method's network part a limit (site adapter 20 s, fetch 20 s, Jina 30 s) and every text part 20 s", () => {
    expect(DEFAULT_LIMITS).toEqual({ adapter: 20_000, fetch: 20_000, jina: 30_000, text: 20_000 });
  });

  it("reads a paper with its site adapter first", async () => {
    const web = fakeWeb({ [PAPER_HTML]: paperPage(prose("paper", 2_000)) });

    const read = await readArticle(PAPER_ABS, { fetch: web.fetch });

    expect(web.calls).toEqual([PAPER_HTML]);
    expect(read).toMatchObject({ url: PAPER_ABS, status: "read", method: "arxiv", finalUrl: PAPER_HTML, error: null });
    expect(read.text).toContain("paper pretend lab");
    expect(read.attempts).toEqual([expect.objectContaining({ method: "arxiv", outcome: "read", httpStatus: 200 })]);
  });

  it("falls through from a failed adapter to fetch, then from text that fails the check to Jina", async () => {
    const web = fakeWeb({
      [PAPER_HTML]: () => new Response("No HTML", { status: 404 }),
      [PAPER_ABS]: htmlPage("Too short to count."),
      [jinaUrl(PAPER_ABS)]: jinaAnswer(PAPER_ABS, prose("jina")),
    });

    const read = await readArticle(PAPER_ABS, { fetch: web.fetch });

    expect(web.calls).toEqual([PAPER_HTML, PAPER_ABS, jinaUrl(PAPER_ABS)]);
    expect(read).toMatchObject({ status: "read", method: "jina", error: null });
    expect(read.text).toContain("jina pretend lab");
    expect(read.attempts.map(({ method, outcome, error }) => ({ method, outcome, error }))).toEqual([
      { method: "arxiv", outcome: "failed", error: "HTTP 404." },
      { method: "fetch", outcome: "failed", error: expect.stringMatching(/^Only \d+ characters of text\.$/) },
      { method: "jina", outcome: "read", error: undefined },
    ]);
  });

  it("starts with fetch when the link has no site adapter, and stops at the first text that passes", async () => {
    const web = fakeWeb({ [STORY]: htmlPage(prose("fetched")) });

    const read = await readArticle(STORY, { fetch: web.fetch });

    expect(web.calls).toEqual([STORY]);
    expect(read).toMatchObject({ status: "read", method: "fetch" });
    expect(read.text).toContain("fetched pretend lab");
    expect(read.text).not.toContain("Fake footer");
  });

  it("leaves the article unread when every method fails, with the strongest reason as its status", async () => {
    const web = fakeWeb({
      [STORY]: htmlPage(`${prose("teaser", 600)} Subscribe to continue reading.`),
      [jinaUrl(STORY)]: jinaError(403, "Anonymous access to domain news.example.com blocked."),
    });

    const read = await readArticle(STORY, { fetch: web.fetch });

    expect(read).toMatchObject({ status: "paywalled", method: null, text: null, chars: 0 });
    expect(read.error).toBe("fetch: A paywall. jina: Jina returned HTTP 403: Anonymous access to domain news.example.com blocked.");
  });

  it("counts a bot block as blocked when no method saw a paywall", async () => {
    const web = fakeWeb({ [STORY]: htmlPage("Forbidden", 403), [jinaUrl(STORY)]: jinaAnswer(STORY, "Just a moment...") });
    await expect(readArticle(STORY, { fetch: web.fetch })).resolves.toMatchObject({ status: "blocked", error: "fetch: HTTP 403. jina: A bot check or block page." });
  });

  it("asks Jina with no Authorization header when there is no Jina key", async () => {
    const web = fakeWeb({ [STORY]: htmlPage("Forbidden", 403), [jinaUrl(STORY)]: jinaAnswer(STORY, prose("anonymous")) });

    const read = await readArticle(STORY, { fetch: web.fetch });

    expect(read).toMatchObject({ status: "read", method: "jina" });
    expect(web.sentAuthorization(jinaUrl(STORY))).toBe(false);
  });

  it.each([
    [402, "Insufficient balance."],
    [429, "Per IP rate limit exceeded."],
  ])("leaves the article failed, with Jina's reason, when Jina answers HTTP %i", async (status, reason) => {
    const web = fakeWeb({ [STORY]: htmlPage("Not found", 404), [jinaUrl(STORY)]: jinaError(status, reason) });

    const read = await readArticle(STORY, { fetch: web.fetch });

    expect(read).toMatchObject({ status: "failed", method: null, text: null });
    expect(read.error).toBe(`fetch: HTTP 404. jina: Jina returned HTTP ${status}: ${reason}`);
  });

  it("cuts a method off at its network limit, even if it ignores the abort, and moves on", async () => {
    const web = fakeWeb({ [STORY]: hang, [jinaUrl(STORY)]: jinaAnswer(STORY, prose("rescued")) });

    const read = await readArticle(STORY, { fetch: web.fetch, limits: { fetch: 20 } });

    expect(read).toMatchObject({ status: "read", method: "jina" });
    expect(read.attempts[0]).toMatchObject({ method: "fetch", outcome: "failed", error: "Network part timed out after 0.02 s." });
  });

  it("stops, without trying another method, when the step's deadline signal fires", async () => {
    const web = fakeWeb({ [STORY]: hang });
    const deadline = new AbortController();
    setTimeout(() => deadline.abort(new Error("The read step's deadline passed.")), 20);

    const read = await readArticle(STORY, { fetch: web.fetch, signal: deadline.signal });

    expect(web.calls).toEqual([STORY]);
    expect(read).toMatchObject({ status: "failed", error: "fetch: The read step's deadline passed." });
  });

  it("refuses a private link without sending any request", async () => {
    const web = fakeWeb({});

    const read = await readArticle("http://169.254.169.254/latest/meta-data/", { fetch: web.fetch });

    expect(web.fetch).not.toHaveBeenCalled();
    expect(read).toMatchObject({ status: "failed", method: null, attempts: [], error: "Refused 169.254.169.254: a private address." });
  });

  it("keeps the first 50,000 characters and reports the full length", async () => {
    const web = fakeWeb({ [STORY]: () => new Response(prose("long", 60_000), { headers: { "content-type": "text/plain" } }) });

    const read = await readArticle(STORY, { fetch: web.fetch });

    expect(MAX_TEXT_CHARS).toBe(50_000);
    expect(read.text).toHaveLength(50_000);
    expect(read.chars).toBe(prose("long", 60_000).length);
    expect(read.chars).toBeGreaterThan(59_000);
  });

  it.each([
    ["tags nested 4,000 deep", hostileHtml.deep(4_000), "The page nests HTML tags over 400 deep."],
    ["600,000 tiny elements", hostileHtml.tiny(600_000), "The page has over 30,000 HTML elements."],
  ])("refuses a hostile page (%s) before parsing it, well within the fetch timeout, and lets Jina try", async (_kind, html, reason) => {
    const web = fakeWeb({ [STORY]: rawHtml(html), [jinaUrl(STORY)]: jinaAnswer(STORY, prose("rescued")) });
    const parse = vi.fn<TextParser>(parseInThisThread);
    const started = performance.now();

    const read = await readArticle(STORY, { fetch: web.fetch, parse });

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(read).toMatchObject({ status: "read", method: "jina" });
    expect(read.attempts[0]).toMatchObject({ method: "fetch", outcome: "failed", error: reason });
    expect(parse.mock.calls.map(([job]) => job.kind)).toEqual(["markdown"]);
  });

  it("stops the parse at the text limit, as the worker is stopped, and moves on", async () => {
    const web = fakeWeb({ [STORY]: htmlPage(prose("slow")), [jinaUrl(STORY)]: jinaAnswer(STORY, prose("rescued")) });
    const stopped: unknown[] = [];
    // Stands in for the worker: it gets its slot at once, then ends only when its signal aborts.
    const slowParse: TextParser = (job, signal, onStart) =>
      job.kind !== "readable"
        ? parseInThisThread(job, signal, onStart)
        : new Promise((_resolve, reject) => {
            onStart();
            signal.addEventListener("abort", () => {
              stopped.push(signal.reason);
              reject(signal.reason);
            });
          });

    const read = await readArticle(STORY, { fetch: web.fetch, parse: slowParse, limits: { text: 30 } });

    expect(stopped).toEqual([expect.objectContaining({ message: "Text part timed out after 0.03 s." })]);
    expect(read).toMatchObject({ status: "read", method: "jina" });
    expect(read.attempts[0]).toMatchObject({ method: "fetch", outcome: "failed", error: "Text part timed out after 0.03 s." });
  });

  it("stores a PDF whose text job is stopped at the text limit as a pdf attempt", async () => {
    const web = fakeWeb({ [STORY]: pdfResponse(pdfDocument(prose("slow"))), [jinaUrl(STORY)]: jinaAnswer(STORY, prose("rescued")) });
    const slowParse: TextParser = (job, signal, onStart) =>
      job.kind !== "pdf"
        ? parseInThisThread(job, signal, onStart)
        : new Promise((_resolve, reject) => {
            onStart();
            signal.addEventListener("abort", () => reject(signal.reason));
          });

    const read = await readArticle(STORY, { fetch: web.fetch, parse: slowParse, limits: { text: 30 } });

    expect(read).toMatchObject({ status: "read", method: "jina" });
    expect(read.attempts[0]).toMatchObject({ method: "pdf", outcome: "failed", error: "Text part timed out after 0.03 s." });
  });

  it("reads a page whose text job waits for a worker slot longer than the page's network limit", async () => {
    const web = fakeWeb({ [STORY]: htmlPage(prose("queued")) });
    // Stands in for a busy worker pool: the slot comes after 80 ms, past the 30 ms network limit.
    const queuedParse: TextParser = (job, signal, onStart) =>
      new Promise((resolve) => setTimeout(resolve, 80)).then(() => parseInThisThread(job, signal, onStart));

    const read = await readArticle(STORY, { fetch: web.fetch, parse: queuedParse, limits: { fetch: 30, text: 1_000 } });

    expect(read).toMatchObject({ status: "read", method: "fetch" });
    expect(read.text).toContain("queued pretend lab");
  });

  it("records how long each attempt waited for its host and worker slots, and how long its text part took", async () => {
    let clock = 0;
    const limiter = new HostLimiter(1);
    // Another read holds the host slot for 50 ms.
    const busy = limiter.run("news.example.com", new AbortController().signal, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      clock += 50;
    });
    const web = fakeWeb({
      [STORY]: () => {
        clock += 100;
        return htmlPage(prose("timed"))();
      },
    });
    // 300 ms in the worker queue, then 200 ms of text work.
    const parse: TextParser = async (job, signal, onStart) => {
      clock += 300;
      onStart();
      const text = await parseInThisThread(job, signal, () => undefined);
      clock += 200;
      return text;
    };

    const read = await readArticle(STORY, { fetch: web.fetch, limiter, parse, now: () => clock });
    await busy;

    expect(read.attempts).toEqual([expect.objectContaining({ method: "fetch", outcome: "read", ms: 650, waitMs: 350, textMs: 200 })]);
    expect(read.ms).toBe(650);
  });

  it("starts a method's clock once its host slot is free, so waiting on another read does not use up its timeout", async () => {
    const limiter = new HostLimiter(1);
    const web = fakeWeb({ [STORY]: htmlPage(prose("patient")) });
    const busy = limiter.run("news.example.com", new AbortController().signal, () => new Promise((resolve) => setTimeout(resolve, 80)));

    const read = await readArticle(STORY, { fetch: web.fetch, limiter, limits: { fetch: 40 } });
    await busy;

    expect(read).toMatchObject({ status: "read", method: "fetch" });
  });

  it("pauses a method's network limit while a redirect waits for its new host's slot, and counts every wait", async () => {
    const limiter = new HostLimiter(1);
    const moved = "https://other.example.com/toy-arm";
    const web = fakeWeb({
      [STORY]: () => new Response(null, { status: 302, headers: { location: moved } }),
      [moved]: htmlPage(prose("moved")),
    });
    // Another read holds the new host's slot for 80 ms, past the 40 ms network limit.
    const busy = limiter.run("other.example.com", new AbortController().signal, () => new Promise((resolve) => setTimeout(resolve, 80)));

    const read = await readArticle(STORY, { fetch: web.fetch, limiter, limits: { fetch: 40 } });
    await busy;

    expect(read).toMatchObject({ status: "read", method: "fetch", finalUrl: moved });
    expect(read.attempts[0].waitMs).toBeGreaterThanOrEqual(70);
  });

  it("reads a page served as Markdown", async () => {
    const web = fakeWeb({
      [STORY]: () =>
        new Response(`# Pretend story\n\n**${prose("markdown")}**\n`, { headers: { "content-type": "text/markdown; charset=utf-8" } }),
    });

    const read = await readArticle(STORY, { fetch: web.fetch });

    expect(read).toMatchObject({ status: "read", method: "fetch" });
    expect(read.text).toContain("Pretend story");
    expect(read.text).toContain("The markdown pretend lab shared");
    expect(read.text).not.toContain("**");
  });

  it("reads a PDF link as a PDF, from the one download, and stores the method as pdf", async () => {
    const web = fakeWeb({ [STORY]: pdfResponse(pdfDocument(prose("filing"))) });

    const read = await readArticle(STORY, { fetch: web.fetch });

    expect(web.calls).toEqual([STORY]);
    expect(read).toMatchObject({ status: "read", method: "pdf", finalUrl: STORY, error: null });
    expect(read.text).toContain("The filing pretend lab shared made-up results");
    expect(read.attempts).toEqual([expect.objectContaining({ method: "pdf", outcome: "read", httpStatus: 200 })]);
  });

  it("reads a PDF over the 5 MB page cap, but refuses one over the 20 MB PDF cap as too large and lets Jina try", async () => {
    const pdf = pdfDocument(prose("filing"));
    const big = "https://news.example.com/big.pdf";
    const huge = "https://news.example.com/huge.pdf";
    const web = fakeWeb({
      // The cap is checked against the declared length first, so these stand in for 6 MB and 21 MB files.
      [big]: pdfResponse(pdf, { "content-length": "6000000" }),
      [huge]: pdfResponse(pdf, { "content-length": "21000000" }),
      [jinaUrl(huge)]: jinaError(422, "No content."),
    });

    await expect(readArticle(big, { fetch: web.fetch })).resolves.toMatchObject({ status: "read", method: "pdf" });
    const read = await readArticle(huge, { fetch: web.fetch });

    expect(read).toMatchObject({ status: "failed", method: null });
    expect(read.attempts.map(({ method, outcome, error }) => ({ method, outcome, error }))).toEqual([
      { method: "pdf", outcome: "failed", error: "The response is over the 20 MB cap." },
      { method: "jina", outcome: "failed", error: "Jina returned HTTP 422: No content." },
    ]);
  });

  it("fails a broken PDF as a pdf attempt and goes on to Jina", async () => {
    const web = fakeWeb({
      [STORY]: pdfResponse(new TextEncoder().encode("%PDF-1.4\nThis is not really a PDF.")),
      [jinaUrl(STORY)]: jinaAnswer(STORY, prose("rescued")),
    });

    const read = await readArticle(STORY, { fetch: web.fetch });

    expect(read).toMatchObject({ status: "read", method: "jina" });
    expect(read.attempts.map(({ method, outcome, error }) => ({ method, outcome, error }))).toEqual([
      { method: "pdf", outcome: "failed", error: expect.stringMatching(/^Not a readable PDF: /) },
      { method: "jina", outcome: "read", error: undefined },
    ]);
  });

  it("refuses an HTML page over the 5 MB cap", async () => {
    const web = fakeWeb({ [STORY]: () => new Response("<html></html>", { headers: { "content-type": "text/html", "content-length": "6000000" } }) });

    const read = await readArticle(STORY, { fetch: web.fetch });

    expect(read.attempts[0]).toMatchObject({ method: "fetch", outcome: "failed", error: "The response is over the 5 MB cap." });
  });

  it("stops, without passing the link to Jina, when a redirect points at a private address", async () => {
    const web = fakeWeb({
      [STORY]: () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8080/admin" } }),
      [jinaUrl(STORY)]: jinaAnswer(STORY, prose("should not be asked")),
    });

    const read = await readArticle(STORY, { fetch: web.fetch });

    expect(web.calls).toEqual([STORY]);
    expect(read).toMatchObject({ status: "failed", method: null, error: "fetch: Refused 127.0.0.1: a private address." });
    expect(read.attempts).toHaveLength(1);
  });
});
