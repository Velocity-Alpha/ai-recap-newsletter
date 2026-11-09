import { describe, expect, it, vi } from "vitest";

import { parseInThisThread } from "@/src/pipeline/draft/articles/html-worker";
import type { FetchLike } from "@/src/pipeline/draft/articles/http";
import { matchSiteAdapter } from "@/src/pipeline/draft/articles/site-adapters";
import { READER_USER_AGENT } from "@/src/pipeline/draft/articles/types";

describe("matchSiteAdapter", () => {
  it.each([
    ["https://arxiv.org/abs/2401.01234", "arxiv", "https://arxiv.org/html/2401.01234"],
    ["https://arxiv.org/abs/2401.01234v2?context=cs", "arxiv", "https://arxiv.org/html/2401.01234v2"],
    ["https://www.arxiv.org/pdf/2401.01234.pdf", "arxiv", "https://arxiv.org/html/2401.01234"],
    ["https://arxiv.org/pdf/2401.01234v3", "arxiv", "https://arxiv.org/html/2401.01234v3"],
    ["https://arxiv.org/html/2401.01234v1/", "arxiv", "https://arxiv.org/html/2401.01234v1"],
    ["https://huggingface.co/papers/2511.04567", "arxiv", "https://arxiv.org/html/2511.04567"],
    ["https://hf.co/papers/2511.04567#community", "arxiv", "https://arxiv.org/html/2511.04567"],
    ["https://github.com/toy-org/toy-repo", "github", "https://api.github.com/repos/toy-org/toy-repo/readme"],
    ["https://www.github.com/toy-org/toy-repo.git/?tab=readme-ov-file#readme", "github", "https://api.github.com/repos/toy-org/toy-repo/readme"],
    ["https://huggingface.co/toy-org/toy-model-7b", "huggingface", "https://huggingface.co/toy-org/toy-model-7b/resolve/main/README.md"],
  ])("reads %s with the %s adapter from %s", (url, method, source) => {
    expect(matchSiteAdapter(url)).toMatchObject({ method, source });
  });

  it.each([
    "https://arxiv.org/list/cs.AI/recent",
    "https://arxiv.org/abs/hep-th/9901001",
    "https://github.com/toy-org",
    "https://github.com/toy-org/toy-repo/issues/12",
    "https://github.com/toy-org/toy-repo/blob/main/docs/guide.md",
    "https://github.com/features/copilot",
    "https://github.com/orgs/toy-org",
    "https://huggingface.co/blog/toy-post",
    "https://huggingface.co/docs/transformers",
    "https://huggingface.co/datasets/toy-org/toy-data",
    "https://huggingface.co/spaces/toy-org/toy-demo",
    "https://huggingface.co/papers",
    "https://news.example.com/arxiv.org/abs/2401.01234",
  ])("has no adapter for %s", (url) => {
    expect(matchSiteAdapter(url)).toBeNull();
  });
});

function respond(body: string, status = 200, contentType = "text/html; charset=utf-8") {
  return vi.fn<FetchLike>(async () => new Response(body, { status, headers: { "content-type": contentType } }));
}

const signal = new AbortController().signal;

describe("arXiv adapter", () => {
  const PAPER = `<!DOCTYPE html><html><body>
    <nav class="ltx_page_navbar"><a href="#S1">1 Introduction</a></nav>
    <article class="ltx_document">
      <h1 class="ltx_title">A Pretend Paper on Toy Models</h1>
      <div class="ltx_abstract"><h6>Abstract</h6><p>We study invented models on synthetic data.</p></div>
      <nav class="ltx_TOC"><ol><li>Table of contents entry</li></ol></nav>
      <section class="ltx_section"><h2>1 Introduction</h2>
        <div class="ltx_para"><p>The toy loss is <math alttext="L = x^{2}"><semantics><mi>L</mi><annotation encoding="application/x-tex">L = x^{2}</annotation></semantics></math> on made-up inputs.</p></div>
      </section>
      <section class="ltx_bibliography"><h2>References</h2><ul><li>An invented citation.</li></ul></section>
      <section class="ltx_appendix"><h2>Appendix A</h2><p>Extra pretend proofs.</p></section>
    </article>
  </body></html>`;

  it("reads the arXiv HTML paper without references, appendices or the contents list, and keeps math as TeX", async () => {
    const fetch = respond(PAPER);

    const result = await matchSiteAdapter("https://huggingface.co/papers/2511.04567")!.read({ fetch, signal, parse: parseInThisThread });

    expect(fetch.mock.calls[0][0]).toBe("https://arxiv.org/html/2511.04567");
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ "User-Agent": READER_USER_AGENT });
    expect(result.httpStatus).toBe(200);
    expect(result.text).toBe(
      "A Pretend Paper on Toy Models\n\nAbstract\n\nWe study invented models on synthetic data.\n\n1 Introduction\n\nThe toy loss is L = x^{2} on made-up inputs.",
    );
  });

  it("passes a missing HTML version on as its status", async () => {
    const result = await matchSiteAdapter("https://arxiv.org/abs/2401.01234")!.read({ fetch: respond("No HTML for this paper", 404), signal, parse: parseInThisThread });
    expect(result).toMatchObject({ text: "", httpStatus: 404 });
  });
});

describe("GitHub adapter", () => {
  const README = "# Toy Repo\n\n[![ci](https://img.example.com/b.svg)](https://ci.example.com)\n\nA **pretend** library for [toy agents](https://docs.example.com).";

  it("reads the README from the GitHub API as raw Markdown, with no token by default", async () => {
    const fetch = respond(README, 200, "text/plain; charset=utf-8");

    const result = await matchSiteAdapter("https://github.com/toy-org/toy-repo")!.read({ fetch, signal, parse: parseInThisThread });

    expect(fetch.mock.calls[0][1].headers).toEqual({
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": READER_USER_AGENT,
    });
    expect(result).toEqual({ text: "Toy Repo\n\nA pretend library for toy agents.", httpStatus: 200, finalUrl: "https://github.com/toy-org/toy-repo" });
  });

  it("sends GITHUB_TOKEN when there is one", async () => {
    const fetch = respond(README, 200, "text/plain");
    await matchSiteAdapter("https://github.com/toy-org/toy-repo")!.read({ fetch, signal, parse: parseInThisThread, githubToken: "gh-test-token" });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer gh-test-token" });
  });

  it("passes a repo without a README on as its status", async () => {
    const result = await matchSiteAdapter("https://github.com/toy-org/toy-repo")!.read({ fetch: respond('{"message":"Not Found"}', 404), signal, parse: parseInThisThread });
    expect(result).toMatchObject({ text: "", httpStatus: 404 });
  });
});

describe("Hugging Face model adapter", () => {
  it("reads the model card without its YAML header", async () => {
    const fetch = respond("---\nlicense: mit\n---\n# Toy Model 7B\n\nAn invented model card.", 200, "text/plain");

    const result = await matchSiteAdapter("https://huggingface.co/toy-org/toy-model-7b")!.read({ fetch, signal, parse: parseInThisThread });

    expect(fetch.mock.calls[0][0]).toBe("https://huggingface.co/toy-org/toy-model-7b/resolve/main/README.md");
    expect(result).toEqual({ text: "Toy Model 7B\n\nAn invented model card.", httpStatus: 200, finalUrl: "https://huggingface.co/toy-org/toy-model-7b" });
  });
});
