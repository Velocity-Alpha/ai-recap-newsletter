import { describe, expect, it, vi } from "vitest";

import { fakeWeb, htmlPage, jinaAnswer, jinaUrl, prose } from "@/src/pipeline/draft/articles/fake-web.fixture";
import answers from "@/src/pipeline/free-links/__fixtures__/search-answers.json";
import { checkLinks, countWords, READ_DEADLINE_MS, type LinkRead } from "@/src/pipeline/free-links/check-links";
import { parseSearchAnswer } from "@/src/pipeline/free-links/search";

const STORY = { id: 7, url: "https://www.wsj.com/tech/ai/pretend-lab-toy-model" };

function words(count: number): string {
  return Array.from({ length: count }, () => "word").join(" ");
}

/** A reader that gives each link the text of the given word count. 0, or a link not listed, is a failed read. */
function readerOf(wordsByUrl: Record<string, number | "paywalled">) {
  return vi.fn(async (urls: string[]): Promise<LinkRead[]> =>
    urls.map((url) => {
      const count = wordsByUrl[url];
      if (count === "paywalled") return { url, status: "paywalled", text: null };
      return count ? { url, status: "read", text: words(count) } : { url, status: "failed", text: null };
    }),
  );
}

function depsOf(wordsByUrl: Record<string, number | "paywalled">, learnedSites: string[] = []) {
  return { read: readerOf(wordsByUrl), learnedSites, recordPaywalledSite: vi.fn(async () => {}) };
}

describe("countWords", () => {
  it("counts the words of a text", () => {
    expect(countWords("  one two\n\nthree\tfour ")).toBe(4);
    expect(countWords("   ")).toBe(0);
  });
});

describe("checkLinks", () => {
  it("gives the reads of one story the draft step's 120 s deadline", () => {
    expect(READ_DEADLINE_MS).toBe(120_000);
  });

  it("keeps a link that reads as an article of 300 words or more, with its site, title and words", async () => {
    const deps = depsOf({ "https://www.free.example/a": 300 });

    const links = await checkLinks(STORY, [{ url: "https://www.free.example/a", title: "A" }], deps);

    expect(links).toEqual([{ url: "https://www.free.example/a", site: "free.example", title: "A", words: 300 }]);
  });

  it("reads with the draft's article reader, Jina last and with no key", async () => {
    const link = "https://www.free.example/a";
    const web = fakeWeb({ [link]: htmlPage("Forbidden", 403), [jinaUrl(link)]: jinaAnswer(link, prose("free", 3_000)) });

    const links = await checkLinks(STORY, [{ url: link, title: "A" }], { readOptions: { fetch: web.fetch }, recordPaywalledSite: vi.fn(async () => {}) });

    expect(links).toEqual([expect.objectContaining({ url: link, site: "free.example" })]);
    expect(web.sentAuthorization(jinaUrl(link))).toBe(false);
  });

  it("drops a link on the site of the original link, without a read", async () => {
    const deps = depsOf({ "https://wsj.com/other": 900 });

    await expect(checkLinks(STORY, [{ url: "https://wsj.com/other", title: "Other" }], deps)).resolves.toEqual([]);
    expect(deps.read).not.toHaveBeenCalled();
  });

  it("drops a social or aggregator link, without a read", async () => {
    const deps = depsOf({ "https://www.reddit.com/r/ai/comments/1": 900, "https://old.reddit.com/r/ai/2": 900 });
    const candidates = [
      { url: "https://www.reddit.com/r/ai/comments/1", title: "Thread" },
      { url: "https://old.reddit.com/r/ai/2", title: "Thread 2" },
    ];

    await expect(checkLinks(STORY, candidates, deps)).resolves.toEqual([]);
    expect(deps.read).not.toHaveBeenCalled();
  });

  it("drops a link on a paywalled site of the list or a learned paywalled site, without a read", async () => {
    const deps = depsOf({ "https://www.ft.com/a": 900, "https://learned.example/a": 900 }, ["learned.example"]);
    const candidates = [
      { url: "https://www.ft.com/a", title: "FT" },
      { url: "https://learned.example/a", title: "Learned" },
    ];

    await expect(checkLinks(STORY, candidates, deps)).resolves.toEqual([]);
    expect(deps.read).not.toHaveBeenCalled();
  });

  it("drops a link that could not be read, and one with fewer than 300 words", async () => {
    const deps = depsOf({ "https://short.example/a": 299, "https://free.example/a": 400 });
    const candidates = [
      { url: "https://broken.example/a", title: "Broken" },
      { url: "https://short.example/a", title: "Short" },
      { url: "https://free.example/a", title: "Free" },
    ];

    const links = await checkLinks(STORY, candidates, deps);

    expect(links.map((link) => link.url)).toEqual(["https://free.example/a"]);
    expect(deps.recordPaywalledSite).not.toHaveBeenCalled();
  });

  it("drops a link the reader found paywalled, and records its site for the story", async () => {
    const deps = depsOf({ "https://www.walled.example/a": "paywalled" });

    await expect(checkLinks(STORY, [{ url: "https://www.walled.example/a", title: "Walled" }], deps)).resolves.toEqual([]);
    expect(deps.recordPaywalledSite).toHaveBeenCalledWith("walled.example", 7);
  });

  it("keeps at most 3 links, in the given order, and reads each link once", async () => {
    const urls = ["https://a.example/1", "https://b.example/1", "https://a.example/1", "https://c.example/1", "https://d.example/1"];
    const deps = depsOf(Object.fromEntries(urls.map((url) => [url, 500])));

    const links = await checkLinks(STORY, urls.map((url) => ({ url, title: "" })), deps);

    expect(links.map((link) => link.url)).toEqual(["https://a.example/1", "https://b.example/1", "https://c.example/1"]);
    expect(deps.read).toHaveBeenCalledWith(["https://a.example/1", "https://b.example/1", "https://c.example/1", "https://d.example/1"]);
    expect(links[0].title).toBeNull();
  });

  it("does not read when no link is left", async () => {
    const deps = depsOf({});

    await expect(checkLinks(STORY, [], deps)).resolves.toEqual([]);
    expect(deps.read).not.toHaveBeenCalled();
  });

  describe("the recorded answers", () => {
    function run(storyId: number) {
      const entry = answers.find((answer) => answer.story.id === storyId)!;
      const deps = depsOf(Object.fromEntries(entry.reads.map((read) => [read.url, read.words])));
      return { deps, links: checkLinks(entry.story, parseSearchAnswer(entry.answer)!, deps) };
    }

    it.each(answers.map((entry) => entry.story.id))("keeps one free link or more for story %i", async (storyId) => {
      const links = await run(storyId).links;

      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links.length).toBeLessThanOrEqual(3);
      for (const link of links) expect(link.words).toBeGreaterThanOrEqual(300);
    });

    it("drops fortune.com for story 10621 at the site list, without a read", async () => {
      const { deps, links } = run(10621);

      expect((await links).map((link) => link.site)).toEqual(["sec.gov", "apnews.com"]);
      const readUrls = deps.read.mock.calls.flatMap(([urls]) => urls);
      expect(readUrls.some((url) => url.includes("fortune.com"))).toBe(false);
    });

    it("drops the short links: arxiv.org for story 10342 and axios.com for story 10844", async () => {
      expect((await run(10342).links).map((link) => link.site)).toEqual(["the-decoder.com", "eurekalert.org"]);
      expect((await run(10844).links).map((link) => link.site)).toEqual(["investor.nvidia.com"]);
    });
  });
});
