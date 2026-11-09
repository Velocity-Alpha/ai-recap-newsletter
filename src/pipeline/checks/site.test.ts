import { describe, expect, it, vi } from "vitest";

import { htmlContainsText, readSiteFacts } from "@/src/pipeline/checks/site";

const ISSUE = { slug: "synthetic-model-ships", title: "Synthetic Model Ships & Agents' Day" };

function fakeFetch(pages: Record<string, { status: number; body: string } | Error>) {
  return vi.fn(async (url: string | URL | Request) => {
    const page = pages[String(url)];
    if (!page) throw new Error(`unexpected fetch ${String(url)}`);
    if (page instanceof Error) throw page;
    return new Response(page.body, { status: page.status });
  }) as unknown as typeof fetch;
}

describe("htmlContainsText", () => {
  it("finds a title that React escaped", () => {
    expect(htmlContainsText("<h1>Synthetic Model Ships &amp; Agents&#x27; Day</h1>", ISSUE.title)).toBe(true);
    expect(htmlContainsText("<h1>Synthetic   Model Ships &amp; Agents&#39; Day</h1>", ISSUE.title)).toBe(true);
    expect(htmlContainsText("<h1>Something else</h1>", ISSUE.title)).toBe(false);
  });
});

describe("readSiteFacts", () => {
  it("reads the issue page and the home page of the public site", async () => {
    const fetch = fakeFetch({
      "https://airecap.news/issue/synthetic-model-ships": { status: 200, body: "<h1>Synthetic Model Ships &amp; Agents&#x27; Day</h1>" },
      "https://airecap.news/": { status: 200, body: '<a href="/issue/synthetic-model-ships">' },
    });

    await expect(readSiteFacts(ISSUE, { siteUrl: "https://airecap.news", fetch })).resolves.toEqual({
      issueUrl: "https://airecap.news/issue/synthetic-model-ships",
      issuePage: { status: 200, hasTitle: true },
      homeUrl: "https://airecap.news/",
      home: { status: 200, listsIssue: true },
    });
  });

  it("reports a missing page, a missing title, and a home page without the issue", async () => {
    const fetch = fakeFetch({
      "https://airecap.news/issue/synthetic-model-ships": { status: 404, body: "Not found" },
      "https://airecap.news/": { status: 200, body: '<a href="/issue/an-older-issue">' },
    });

    const facts = await readSiteFacts(ISSUE, { siteUrl: "https://airecap.news/", fetch });

    expect(facts.issuePage).toEqual({ status: 404, hasTitle: false });
    expect(facts.home).toEqual({ status: 200, listsIssue: false });
  });

  it("reports a fetch error without throwing", async () => {
    const fetch = fakeFetch({
      "https://airecap.news/issue/synthetic-model-ships": new Error("The operation timed out."),
      "https://airecap.news/": { status: 500, body: "" },
    });

    const facts = await readSiteFacts(ISSUE, { siteUrl: "https://airecap.news", fetch });

    expect(facts.issuePage).toEqual({ status: null, hasTitle: false, error: "The operation timed out." });
    expect(facts.home).toEqual({ status: 500, listsIssue: false });
  });
});
