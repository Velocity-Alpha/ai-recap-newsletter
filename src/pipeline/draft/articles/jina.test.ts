import { describe, expect, it, vi } from "vitest";

import { parseInThisThread } from "@/src/pipeline/draft/articles/html-worker";
import type { FetchLike } from "@/src/pipeline/draft/articles/http";
import { readWithJina } from "@/src/pipeline/draft/articles/jina";
import { MethodError, READER_USER_AGENT } from "@/src/pipeline/draft/articles/types";

const ARTICLE_URL = "https://news.example.com/story?id=7";
const MARKDOWN = "# Toy arm\n\nThe pretend lab's [toy arm](https://lab.example.com) folds synthetic towels.\n\n![photo](https://img.example.com/a.png)";

function json(body: unknown, status = 200) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

const ok = { code: 200, status: 20000, data: { title: "Toy arm", url: ARTICLE_URL, content: MARKDOWN, httpStatus: 200 } };

describe("readWithJina", () => {
  it("asks Jina Reader for the link as JSON without images, and with no key by default", async () => {
    const fetch = json(ok);

    const result = await readWithJina(ARTICLE_URL, { fetch, signal: new AbortController().signal, parse: parseInThisThread });

    expect(fetch.mock.calls[0][0]).toBe(`https://r.jina.ai/${ARTICLE_URL}`);
    expect(fetch.mock.calls[0][1].headers).toEqual({ Accept: "application/json", "X-Retain-Images": "none", "User-Agent": READER_USER_AGENT });
    expect(result).toEqual({ text: "Toy arm\n\nThe pretend lab's toy arm folds synthetic towels.", httpStatus: 200, finalUrl: ARTICLE_URL });
  });

  it("sends JINA_API_KEY as a Bearer token when there is one", async () => {
    const fetch = json(ok);
    await readWithJina(ARTICLE_URL, { fetch, signal: new AbortController().signal, parse: parseInThisThread, jinaApiKey: "jina-test-key" });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer jina-test-key" });
  });

  it("reports the status Jina saw on the article", async () => {
    const fetch = json({ ...ok, data: { ...ok.data, httpStatus: 504, content: "Gateway timeout" } });
    await expect(readWithJina(ARTICLE_URL, { fetch, signal: new AbortController().signal, parse: parseInThisThread })).resolves.toMatchObject({ httpStatus: 504 });
  });

  it("counts Jina refusing the domain as blocked, with Jina's reason", async () => {
    const fetch = json({ code: 403, name: "AbuseAlleviationError", readableMessage: "Anonymous access to domain news.example.com blocked." }, 403);

    const error = await readWithJina(ARTICLE_URL, { fetch, signal: new AbortController().signal, parse: parseInThisThread }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MethodError);
    expect(error).toMatchObject({ status: "blocked", message: "Jina returned HTTP 403: Anonymous access to domain news.example.com blocked." });
  });

  it("counts other Jina errors, and answers that are not JSON, as failed", async () => {
    const failedLoad = json({ code: 422, message: "Failed to goto the page" }, 422);
    await expect(readWithJina(ARTICLE_URL, { fetch: failedLoad, signal: new AbortController().signal, parse: parseInThisThread })).rejects.toMatchObject({
      status: "failed",
      message: "Jina returned HTTP 422: Failed to goto the page",
    });

    const html = vi.fn<FetchLike>(async () => new Response("<html>oops</html>", { headers: { "content-type": "text/html" } }));
    await expect(readWithJina(ARTICLE_URL, { fetch: html, signal: new AbortController().signal, parse: parseInThisThread })).rejects.toMatchObject({
      status: "failed",
      message: "Jina returned something other than JSON.",
    });
  });
});
