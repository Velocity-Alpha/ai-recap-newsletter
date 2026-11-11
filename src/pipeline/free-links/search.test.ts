import { describe, expect, it, vi } from "vitest";

import answers from "@/src/pipeline/free-links/__fixtures__/search-answers.json";
import { buildSearchPrompt, parseSearchAnswer, SEARCH_EFFORT, searchFreeLinks, type SearchClient } from "@/src/pipeline/free-links/search";

const STORY = {
  headline: "Pretend Lab Ships A Toy Model",
  summary: "Pretend Lab released a toy model. It is small and made up.",
  url: "https://www.wsj.com/tech/ai/pretend-lab-toy-model",
};

function clientAnswering(text: string | undefined) {
  const create = vi.fn(async () => ({ output_text: text }));
  return { client: { responses: { create } } as unknown as SearchClient, create };
}

describe("buildSearchPrompt", () => {
  it("is the prompt of issue #59, with the story's site, headline and summary", () => {
    expect(buildSearchPrompt(STORY)).toMatchInlineSnapshot(`
      "A newsletter wants to link to this news story, but its link (wsj.com) is paywalled.

      Headline: Pretend Lab Ships A Toy Model
      Summary: Pretend Lab released a toy model. It is small and made up.

      Search the web and find up to 3 free-to-read articles that report this same news. Prefer original reporting, large news sites, and primary sources (a company post, a filing, a court document). Do not return paywalled sites (WSJ, FT, Bloomberg, NYT, The Information, Reuters, CNBC Pro), social media posts, aggregators, or short rewrites. Answer with JSON only: {"links":[{"url":"...","title":"...","site":"..."}]}. Use an empty list when you find none."
    `);
  });
});

describe("searchFreeLinks", () => {
  async function sentCall() {
    const { client, create } = clientAnswering('{"links":[]}');
    await searchFreeLinks(STORY, { client });
    expect(create).toHaveBeenCalledTimes(1);
    const [request, options] = create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    return { request, options };
  }

  it("sends one web search request with the search prompt", async () => {
    expect((await sentCall()).request).toMatchObject({ tools: [{ type: "web_search" }], input: buildSearchPrompt(STORY) });
  });

  it("calls gpt-6-luna", async () => {
    expect((await sentCall()).request.model).toBe("gpt-6-luna");
  });

  it("calls at medium effort", async () => {
    expect(SEARCH_EFFORT).toBe("medium");
    expect((await sentCall()).request.reasoning).toEqual({ effort: "medium" });
  });

  it("gives the call a 120 s limit", async () => {
    expect((await sentCall()).options.timeout).toBe(120_000);
  });

  it("retries the call once", async () => {
    expect((await sentCall()).options.maxRetries).toBe(1);
  });

  it("uses the model and effort it is given (for evals)", async () => {
    const { client, create } = clientAnswering('{"links":[]}');
    await searchFreeLinks(STORY, { client, model: "gpt-6-sol", effort: "high" });
    expect(create).toHaveBeenCalledWith(
      { model: "gpt-6-sol", reasoning: { effort: "high" }, tools: [{ type: "web_search" }], input: buildSearchPrompt(STORY) },
      { timeout: 120_000, maxRetries: 1 },
    );
  });

  it("returns the links of the answer", async () => {
    const { client } = clientAnswering('{"links":[{"url":"https://free.example/a","title":"A","site":"Free"}]}');

    await expect(searchFreeLinks(STORY, { client })).resolves.toEqual([{ url: "https://free.example/a", title: "A" }]);
  });

  it("returns no links, and logs the answer, when the answer has no JSON", async () => {
    const { client } = clientAnswering("I could not find a free article.");
    const log = vi.fn();

    await expect(searchFreeLinks(STORY, { client, log })).resolves.toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("I could not find a free article."));
  });

  it("returns no links for an empty answer", async () => {
    const { client } = clientAnswering(undefined);

    await expect(searchFreeLinks(STORY, { client, log: vi.fn() })).resolves.toEqual([]);
  });
});

describe("parseSearchAnswer", () => {
  it.each(answers.map((entry) => [entry.story.id, entry] as const))("parses the recorded answer for story %i into its links", (_id, entry) => {
    const links = parseSearchAnswer(entry.answer);

    expect(links).not.toBeNull();
    expect(links!.map((link) => link.url)).toEqual(entry.reads.map((read) => read.url));
    for (const link of links!) expect(link.title).not.toBe("");
  });

  it("parses an answer with text around the JSON", () => {
    const answer = 'Here is what I found:\n```json\n{"links":[{"url":"https://free.example/a","title":"A","site":"Free"}]}\n```\nLet me know.';

    expect(parseSearchAnswer(answer)).toEqual([{ url: "https://free.example/a", title: "A" }]);
  });

  it("gives null for an answer with no JSON, with broken JSON, or with no links list", () => {
    expect(parseSearchAnswer("No free article exists.")).toBeNull();
    expect(parseSearchAnswer('{"links":[{"url":')).toBeNull();
    expect(parseSearchAnswer('{"results":[]}')).toBeNull();
    expect(parseSearchAnswer('{"links":"none"}')).toBeNull();
  });

  it("gives an empty list when the model found none", () => {
    expect(parseSearchAnswer('{"links":[]}')).toEqual([]);
  });

  it("keeps only http and https links, and gives a link with no title an empty one", () => {
    const answer = JSON.stringify({
      links: [
        { url: "https://free.example/a" },
        { url: "ftp://files.example/a", title: "File" },
        { url: "javascript:alert(1)", title: "Script" },
        { url: 7, title: "Number" },
        "https://free.example/text",
        { url: "http://plain.example/b", title: "B" },
      ],
    });

    expect(parseSearchAnswer(answer)).toEqual([
      { url: "https://free.example/a", title: "" },
      { url: "http://plain.example/b", title: "B" },
    ]);
  });
});
