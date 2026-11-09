import { describe, expect, it } from "vitest";

import { fakeWeb, hang, htmlPage, jinaAnswer, jinaError, jinaUrl, prose } from "@/src/pipeline/draft/articles/fake-web.fixture";
import { DEFAULT_TIMEOUTS, MAX_TEXT_CHARS, readArticle } from "@/src/pipeline/draft/articles/read-article";

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
  it("uses the #115 order and timeouts: site adapter 20 s, fetch 12 s, Jina 30 s", () => {
    expect(DEFAULT_TIMEOUTS).toEqual({ adapter: 20_000, fetch: 12_000, jina: 30_000 });
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

  it("cuts a method off at its timeout, even if it ignores the abort, and moves on", async () => {
    const web = fakeWeb({ [STORY]: hang, [jinaUrl(STORY)]: jinaAnswer(STORY, prose("rescued")) });

    const read = await readArticle(STORY, { fetch: web.fetch, timeouts: { fetch: 20 } });

    expect(read).toMatchObject({ status: "read", method: "jina" });
    expect(read.attempts[0]).toMatchObject({ method: "fetch", outcome: "failed", error: "Timed out after 0.02 s." });
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

  it("times each method and the whole read with the given clock", async () => {
    let clock = 1_000;
    const web = fakeWeb({ [STORY]: htmlPage("Short."), [jinaUrl(STORY)]: jinaAnswer(STORY, prose("timed")) });

    const read = await readArticle(STORY, { fetch: web.fetch, now: () => (clock += 100) });

    expect(read.attempts.map((attempt) => attempt.ms)).toEqual([100, 100]);
    expect(read.ms).toBe(500);
  });
});
