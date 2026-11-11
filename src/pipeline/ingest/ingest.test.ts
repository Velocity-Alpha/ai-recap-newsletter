import { describe, expect, it, vi } from "vitest";

import type { ExtractedStory, ExtractionInput, Extractor } from "@/src/pipeline/ingest/extract";
import { BEEHIIV_PAGE_LIMIT, ingestStories, type IngestStore, type StoryRow } from "@/src/pipeline/ingest/ingest";
import { BROWSER_USER_AGENT } from "@/src/pipeline/browser-headers";
import type { StorySource } from "@/src/pipeline/ingest/sources";
import { storyGuid } from "@/src/pipeline/ingest/url";
import type { GmailMessage, GmailReader } from "@/src/pipeline/publish/gmail-client";

// Monday 2026-11-09 09:55 New York (EST).
const NOW = new Date("2026-11-09T14:55:00Z");
const HOUR = 3_600_000;

function memoryStore(bookmarks: Record<string, Date> = {}) {
  const rows = new Map<string, StoryRow>();
  const marks = new Map(Object.entries(bookmarks));
  const store: IngestStore = {
    readBookmark: vi.fn(async (source: string) => marks.get(source) ?? null),
    writeBookmark: vi.fn(async (source: string, at: Date) => {
      marks.set(source, at);
    }),
    upsertStories: vi.fn(async (batch: StoryRow[]) => {
      for (const row of batch) rows.set(row.guid, row);
      return batch.length;
    }),
  };
  return { store, rows, marks };
}

function mail(id: string, receivedAt: Date, body: { text?: string; html?: string } = {}): GmailMessage {
  return { id, subject: id, sentAt: receivedAt, receivedAt, text: body.text ?? `text of ${id}`, html: body.html ?? "" };
}

function fakeGmail(messages: GmailMessage[]) {
  const listMessageIds = vi.fn<GmailReader["listMessageIds"]>(async () => messages.map((message) => message.id).reverse());
  const gmail: GmailReader = {
    listMessageIds,
    getMessage: vi.fn(async (id: string) => messages.find((message) => message.id === id)!),
  };
  return { gmail, listMessageIds };
}

function story(overrides: Partial<ExtractedStory> = {}): ExtractedStory {
  return {
    category: "Tools",
    headline: "A Headline",
    summary: "A summary.",
    story_detail: "Detail.",
    published_at: "2026-11-09",
    url: "https://example.org/story/?utm_source=x",
    importance_score: 3,
    ...overrides,
  };
}

// Every page the paywall check opens is free, unless a test routes it.
function fakeFetch(routes: Record<string, () => Response> = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = routes[href];
    if (route) return route();
    return new Response('<script type="application/ld+json">{"isAccessibleForFree":true}</script>');
  });
}

const RUNDOWN: StorySource = { key: "rundown_ai", name: "The Rundown", kind: "gmail", sender: "news@daily.therundown.ai", body: "text", expectedOn: [] };

describe("ingestStories: email sources", () => {
  it("marks a story on a learned paywalled site as paywalled, without opening its page", async () => {
    const { store, rows } = memoryStore();
    const { gmail } = fakeGmail([mail("mon", new Date("2026-11-09T11:06:00Z"))]);
    const fetch = fakeFetch();
    const extract = vi.fn(async () => [story({ url: "https://www.learned.example/story" })]);

    await ingestStories({ gmail, fetch, extract, store, now: NOW, sources: [RUNDOWN], learnedSites: ["learned.example"] });

    expect([...rows.values()]).toEqual([expect.objectContaining({ url: "https://www.learned.example/story", paywallDetected: "yes" })]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads mail since the bookmark, saves cleaned stories, and moves the bookmark to the newest email", async () => {
    const { store, rows, marks } = memoryStore({ rundown_ai: new Date(NOW.getTime() - 48 * HOUR) });
    const sunday = mail("sun", new Date("2026-11-08T11:05:00Z"));
    const monday = mail("mon", new Date("2026-11-09T11:06:00Z"));
    const { gmail, listMessageIds } = fakeGmail([sunday, monday]);
    const extract = vi.fn(async (input: ExtractionInput) =>
      input.text === "text of sun"
        ? [story({ published_at: "2026-11-08", url: "https://example.org/a/" }), story({ url: "" })]
        : [story({ url: "https://example.org/b?utm_medium=email" })],
    );

    const result = await ingestStories({ gmail, fetch: fakeFetch(), extract, store, now: NOW, sources: [RUNDOWN] });

    const since = Math.floor((NOW.getTime() - 48 * HOUR) / 1000);
    expect(listMessageIds).toHaveBeenCalledWith(`from:news@daily.therundown.ai after:${since}`, 20);
    // Oldest first, each with its own New York date as the fallback date.
    expect(extract.mock.calls.map(([input]) => input.sourceDate)).toEqual(["2026-11-08", "2026-11-09"]);
    expect([...rows.values()]).toEqual([
      {
        guid: storyGuid("2026-11-08", "https://example.org/a"),
        day: "2026-11-08",
        headline: "A Headline",
        url: "https://example.org/a",
        summary: "A summary.",
        category: "Tools",
        source: "rundown_ai",
        storyDetails: "Detail.",
        importanceScore: 3,
        paywallDetected: "no",
        error: "",
      },
      expect.objectContaining({ url: "https://example.org/b", day: "2026-11-09", source: "rundown_ai" }),
    ]);
    expect(marks.get("rundown_ai")).toEqual(monday.receivedAt);
    expect(result.sources[0]).toMatchObject({ source: "rundown_ai", status: "ok", documents: 2, stories: 2, skippedNoLink: 1 });
    expect(result.storiesSaved).toBe(2);
  });

  it("never looks back more than 72 hours, and ignores mail at or before the bookmark", async () => {
    const { store } = memoryStore({ rundown_ai: new Date(NOW.getTime() - 10 * 24 * HOUR) });
    const { gmail, listMessageIds } = fakeGmail([]);
    const result = await ingestStories({ gmail, fetch: fakeFetch(), extract: vi.fn(), store, now: NOW, sources: [RUNDOWN] });

    const since = Math.floor((NOW.getTime() - 72 * HOUR) / 1000);
    expect(listMessageIds).toHaveBeenCalledWith(`from:news@daily.therundown.ai after:${since}`, 20);
    expect(result.sources[0]).toMatchObject({ status: "no_new", documents: 0 });
    expect(store.writeBookmark).not.toHaveBeenCalled();

    const bookmark = new Date("2026-11-09T11:00:00Z");
    const again = memoryStore({ rundown_ai: bookmark });
    const extract = vi.fn(async () => [story()]);
    await ingestStories({ gmail: fakeGmail([mail("old", bookmark)]).gmail, fetch: fakeFetch(), extract, store: again.store, now: NOW, sources: [RUNDOWN] });
    expect(extract).not.toHaveBeenCalled();
  });

  it("keeps the bookmark before a failed email so the next run tries it again, and still saves newer mail", async () => {
    const start = new Date(NOW.getTime() - 48 * HOUR);
    const { store, marks } = memoryStore({ rundown_ai: start });
    const first = mail("first", new Date("2026-11-08T09:00:00Z"));
    const broken = mail("broken", new Date("2026-11-08T12:00:00Z"));
    const last = mail("last", new Date("2026-11-09T09:00:00Z"));
    const extract = vi.fn(async (input: ExtractionInput) => {
      if (input.text === "text of broken") throw new Error("Extraction failed twice: model output is not valid JSON.");
      return [story({ url: `https://example.org/${input.text.split(" ").pop()}` })];
    });

    const result = await ingestStories({
      gmail: fakeGmail([first, broken, last]).gmail,
      fetch: fakeFetch(),
      extract,
      store,
      now: NOW,
      sources: [RUNDOWN],
    });

    expect(marks.get("rundown_ai")).toEqual(first.receivedAt);
    expect(result.sources[0]).toMatchObject({ status: "partial", documents: 3, stories: 2 });
    expect(result.sources[0].errors).toEqual(["broken: Extraction failed twice: model output is not valid JSON."]);
  });

  it("does not move the bookmark to a time shared with a failed email", async () => {
    const { store, marks } = memoryStore({ rundown_ai: new Date(NOW.getTime() - 48 * HOUR) });
    const first = mail("first", new Date("2026-11-08T09:00:00Z"));
    const same = mail("same", new Date("2026-11-09T09:00:00Z"));
    const twin = mail("twin", new Date("2026-11-09T09:00:00Z"));
    const extract = vi.fn(async (input: ExtractionInput) => {
      if (input.text === "text of twin") throw new Error("Extraction failed twice: model output is not valid JSON.");
      return [];
    });

    await ingestStories({ gmail: fakeGmail([first, twin, same]).gmail, fetch: fakeFetch(), extract, store, now: NOW, sources: [RUNDOWN] });

    expect(marks.get("rundown_ai")).toEqual(first.receivedAt);
  });

  it("swaps tracking links before extraction and reads HTML sources as text", async () => {
    const source: StorySource = {
      key: "alphasignal",
      name: "AlphaSignal",
      kind: "gmail",
      sender: "news@alphasignal.ai",
      body: "html",
      expectedOn: [],
      trackingLinks: /https:\/\/app\.alphasignal\.ai\/c\?[^"'<> \t\r\n]+/gi,
    };
    const message = mail("a1", new Date("2026-11-09T14:10:00Z"), {
      text: "",
      html: '<p>New <a href="https://app.alphasignal.ai/c?u=1&amp;c=2">repo</a></p>',
    });
    const fetch = fakeFetch({
      "https://app.alphasignal.ai/c?u=1&c=2": () => new Response(null, { status: 302, headers: { location: "https://github.com/org/repo" } }),
    });
    const extract = vi.fn(async () => []);

    await ingestStories({ gmail: fakeGmail([message]).gmail, fetch, extract, store: memoryStore().store, now: NOW, sources: [source] });

    expect(extract).toHaveBeenCalledWith({ sourceDate: "2026-11-09", text: "New [repo](https://github.com/org/repo)" });
  });

  it("keeps one row per guid when a run sees the same story twice", async () => {
    const { store, rows } = memoryStore();
    const extract = vi.fn(async () => [story({ headline: "First" }), story({ headline: "Second" })]);
    const result = await ingestStories({
      gmail: fakeGmail([mail("m", new Date("2026-11-09T11:00:00Z"))]).gmail,
      fetch: fakeFetch(),
      extract,
      store,
      now: NOW,
      sources: [RUNDOWN],
    });
    expect([...rows.values()].map((row) => row.headline)).toEqual(["Second"]);
    expect(result.sources[0].stories).toBe(1);
  });

  it("reports a Gmail failure as a failed source without stopping the others", async () => {
    const gmail: GmailReader = {
      listMessageIds: vi.fn(async () => {
        throw new Error("Gmail request messages failed with HTTP 500.");
      }),
      getMessage: vi.fn(),
    };
    const result = await ingestStories({ gmail, fetch: fakeFetch(), extract: vi.fn(), store: memoryStore().store, now: NOW, sources: [RUNDOWN] });
    expect(result.sources[0]).toMatchObject({ status: "failed", errors: ["Gmail request messages failed with HTTP 500."] });
  });
});

describe("ingestStories: feeds", () => {
  const PRODUCT_HUNT: StorySource = { key: "product_hunt_ai", name: "Product Hunt", kind: "product_hunt", expectedOn: [] };
  const HUGGING_FACE: StorySource = { key: "huggingface", name: "Hugging Face", kind: "hugging_face", expectedOn: [] };
  const FEED = `<feed><entry><published>2026-11-08T09:00:00-08:00</published>
    <link rel="alternate" href="https://www.producthunt.com/products/gadget"/><title>Gadget</title>
    <content type="html">&lt;p&gt;A tool&lt;/p&gt;</content></entry></feed>`;

  it("dates feed stories with the run's date and moves the bookmark to the run time", async () => {
    const { store, rows, marks } = memoryStore();
    const fetch = fakeFetch({ "https://www.producthunt.com/feed?category=artificial-intelligence": () => new Response(FEED) });
    const extract = vi.fn<(input: ExtractionInput) => Promise<ExtractedStory[]>>(async () => [
      story({ published_at: "2026-11-08", url: "https://www.producthunt.com/products/gadget" }),
    ]);

    const result = await ingestStories({ gmail: fakeGmail([]).gmail, fetch, extract, store, now: NOW, sources: [PRODUCT_HUNT] });

    expect(extract.mock.calls[0][0].sourceDate).toBe("2026-11-09");
    expect([...rows.values()][0]).toMatchObject({ day: "2026-11-09", source: "product_hunt_ai", paywallDetected: "no" });
    expect(marks.get("product_hunt_ai")).toEqual(NOW);
    expect(result.sources[0]).toMatchObject({ status: "ok", documents: 1, stories: 1 });
  });

  it("sends the browser User-Agent and a timeout", async () => {
    const fetch = fakeFetch({ "https://www.producthunt.com/feed?category=artificial-intelligence": () => new Response("<feed></feed>") });
    await ingestStories({ gmail: fakeGmail([]).gmail, fetch, extract: vi.fn(), store: memoryStore().store, now: NOW, sources: [PRODUCT_HUNT] });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ "user-agent": BROWSER_USER_AGENT });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a broken Hugging Face page as a failed source", async () => {
    const fetch = fakeFetch({ "https://huggingface.co/papers": () => new Response("<html></html>") });
    const result = await ingestStories({ gmail: fakeGmail([]).gmail, fetch, extract: vi.fn(), store: memoryStore().store, now: NOW, sources: [HUGGING_FACE] });
    expect(result.sources[0]).toMatchObject({ status: "failed", errors: ["Hugging Face page has no daily paper list."] });
  });

  it("does nothing when the feed has no new items", async () => {
    const { store } = memoryStore();
    const fetch = fakeFetch({ "https://www.producthunt.com/feed?category=artificial-intelligence": () => new Response("<feed></feed>") });
    const extract = vi.fn();
    const result = await ingestStories({ gmail: fakeGmail([]).gmail, fetch, extract, store, now: NOW, sources: [PRODUCT_HUNT] });
    expect(extract).not.toHaveBeenCalled();
    expect(store.writeBookmark).not.toHaveBeenCalled();
    expect(result.sources[0]).toMatchObject({ status: "no_new" });
  });
});

describe("ingestStories: beehiiv sites", () => {
  const SITE: StorySource = { key: "example_ai", name: "Example AI", kind: "beehiiv_site", siteUrl: "https://news.example.org", expectedOn: [] };
  const SITEMAP_URL = "https://news.example.org/sitemap.xml";
  const PAGE = "https://news.example.org/p/";
  const TWO_DAYS_AGO = new Date(NOW.getTime() - 48 * HOUR);

  type Entry = { slug: string; lastmod?: string; host?: string };

  function sitemap(entries: Entry[]) {
    const urls = entries
      .map(({ slug, lastmod, host }) => `<url><loc>https://${host ?? "news.example.org"}/p/${slug}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`)
      .join("");
    return `<urlset><url><loc>https://news.example.org/</loc><lastmod>2026-11-09</lastmod></url>${urls}</urlset>`;
  }

  function page(slug: string, publishedAt: string, options: { free?: string; body?: string } = {}) {
    const body = options.body ?? `<div id="content-blocks"><p>body of ${slug}</p></div>`;
    return `<script type="application/ld+json">{"@type":"Article","datePublished":"${publishedAt}","isAccessibleForFree":"${options.free ?? "True"}"}</script>${body}`;
  }

  /** A site whose sitemap lists `entries` (each with lastmod 2026-11-09 unless `entries` says otherwise) and serves `pages` by slug. */
  function site(pages: Record<string, string | number>, entries?: Entry[]) {
    const listed = entries ?? Object.keys(pages).map((slug) => ({ slug, lastmod: "2026-11-09" }));
    return fakeFetch({
      [SITEMAP_URL]: () => new Response(sitemap(listed)),
      ...Object.fromEntries(
        Object.entries(pages).map(([slug, html]) => [
          `${PAGE}${slug}`,
          () => (typeof html === "number" ? new Response("", { status: html }) : new Response(html)),
        ]),
      ),
    });
  }

  const extractFromBody = () =>
    vi.fn(async (input: ExtractionInput) => [story({ published_at: "2026-11-08", url: `https://example.org/${input.text.split(" ").pop()}` })]);

  const run = (fetch: typeof globalThis.fetch, store: IngestStore, extract: Extractor = extractFromBody()) =>
    ingestStories({ gmail: fakeGmail([]).gmail, fetch, extract, store, now: NOW, sources: [SITE] });

  describe("a new post", () => {
    const fetch = () => site({ monday: page("monday", "2026-11-09T03:01:00.000Z") });

    it("passes the New York date of datePublished as the source date", async () => {
      const extract = extractFromBody();
      await run(fetch(), memoryStore().store, extract);
      expect(extract.mock.calls[0][0]).toEqual({ sourceDate: "2026-11-08", text: "body of monday" });
    });

    it("saves stories with their own day and the source key", async () => {
      const { store, rows } = memoryStore();
      const result = await run(fetch(), store);
      expect([...rows.values()]).toEqual([expect.objectContaining({ day: "2026-11-08", source: "example_ai", url: "https://example.org/monday" })]);
      expect(result.sources[0]).toMatchObject({ status: "ok", documents: 1, stories: 1 });
    });

    it("moves the bookmark to datePublished", async () => {
      const { store, marks } = memoryStore({ example_ai: TWO_DAYS_AGO });
      await run(fetch(), store);
      expect(marks.get("example_ai")).toEqual(new Date("2026-11-09T03:01:00.000Z"));
    });
  });

  describe("several new posts", () => {
    const fetch = () => site({ later: page("later", "2026-11-09T05:00:00.000Z"), earlier: page("earlier", "2026-11-08T03:00:00.000Z") });

    it("are extracted oldest first", async () => {
      const extract = extractFromBody();
      await run(fetch(), memoryStore().store, extract);
      expect(extract.mock.calls.map(([input]) => input.text)).toEqual(["body of earlier", "body of later"]);
    });

    it("move the bookmark to the newest", async () => {
      const { store, marks } = memoryStore({ example_ai: TWO_DAYS_AGO });
      await run(fetch(), store);
      expect(marks.get("example_ai")).toEqual(new Date("2026-11-09T05:00:00.000Z"));
    });
  });

  it("skips an old post without a body, with no error", async () => {
    const { store } = memoryStore({ example_ai: new Date("2026-11-09T03:01:00.000Z") });
    const old = page("old", "2026-11-09T03:00:00.000Z", { body: "<div>moved</div>" });
    const result = await run(site({ old }), store, vi.fn());
    expect(result.sources[0]).toMatchObject({ status: "no_new", documents: 0, errors: [] });
  });

  it("skips a post at or before the bookmark without calling the model", async () => {
    const bookmark = new Date("2026-11-09T03:01:00.000Z");
    const { store } = memoryStore({ example_ai: bookmark });
    const extract = vi.fn();
    const result = await run(site({ seen: page("seen", bookmark.toISOString()) }), store, extract);
    expect(extract).not.toHaveBeenCalled();
    expect(store.writeBookmark).not.toHaveBeenCalled();
    expect(result.sources[0]).toMatchObject({ status: "no_new", documents: 0 });
  });

  it("skips a paid post without reading its body", async () => {
    const extract = vi.fn();
    const paid = page("paid", "2026-11-09T05:00:00.000Z", { free: "False", body: "<div>Subscribe to read</div>" });
    const result = await run(site({ paid }), memoryStore().store, extract);
    expect(extract).not.toHaveBeenCalled();
    expect(result.sources[0]).toMatchObject({ status: "no_new", documents: 0, errors: [] });
  });

  it("saves the good posts but keeps the bookmark when a page fails", async () => {
    const { store, rows } = memoryStore({ example_ai: TWO_DAYS_AGO });
    const fetch = site({ good: page("good", "2026-11-08T03:00:00.000Z"), broken: 500 }, [
      { slug: "good", lastmod: "2026-11-08" },
      { slug: "broken", lastmod: "2026-11-09" },
    ]);

    const result = await run(fetch, store);

    expect([...rows.values()].map((row) => row.url)).toEqual(["https://example.org/good"]);
    expect(result.sources[0]).toMatchObject({ status: "partial", documents: 2, stories: 1, errors: [`${PAGE}broken: HTTP 500.`] });
    expect(store.writeBookmark).not.toHaveBeenCalled();
  });

  it.each([
    ["no Article block", '<div id="content-blocks">text</div>', "beehiiv post has no Article data."],
    ["an invalid datePublished", page("bad", "soon"), "beehiiv post has no valid datePublished."],
    ["a future datePublished", page("bad", "2026-11-10T03:00:00.000Z"), "datePublished is in the future (2026-11-10T03:00:00.000Z)."],
    ["a free post with no body", page("bad", "2026-11-09T03:00:00.000Z", { body: "<div>moved</div>" }), "beehiiv post has no #content-blocks element."],
  ])("reports a page with %s as a failed document", async (_, html, error) => {
    const { store } = memoryStore({ example_ai: TWO_DAYS_AGO });
    const extract = vi.fn();
    const result = await run(site({ bad: html }), store, extract);
    expect(extract).not.toHaveBeenCalled();
    expect(result.sources[0]).toMatchObject({ status: "failed", documents: 1, errors: [`${PAGE}bad: ${error}`] });
    expect(store.writeBookmark).not.toHaveBeenCalled();
  });

  it("leaves the bookmark at the last post before a body failure", async () => {
    const { store, marks } = memoryStore({ example_ai: TWO_DAYS_AGO });
    const extract = vi.fn(async (input: ExtractionInput) => {
      if (input.text === "body of broken") throw new Error("model output is not valid JSON.");
      return [];
    });
    const fetch = site({
      first: page("first", "2026-11-08T03:00:00.000Z"),
      broken: page("broken", "2026-11-09T03:00:00.000Z"),
      later: page("later", "2026-11-09T05:00:00.000Z"),
    });

    const result = await run(fetch, store, extract);

    expect(extract).toHaveBeenCalledTimes(3);
    expect(result.sources[0].errors).toEqual([`${PAGE}broken: model output is not valid JSON.`]);
    expect(marks.get("example_ai")).toEqual(new Date("2026-11-08T03:00:00.000Z"));
  });

  it("does not move the bookmark to a time shared with a failed post", async () => {
    const { store, marks } = memoryStore({ example_ai: TWO_DAYS_AGO });
    const extract = vi.fn(async (input: ExtractionInput) => {
      if (input.text === "body of twin") throw new Error("model output is not valid JSON.");
      return [];
    });
    const fetch = site({
      first: page("first", "2026-11-08T03:00:00.000Z"),
      same: page("same", "2026-11-09T03:00:00.000Z"),
      twin: page("twin", "2026-11-09T03:00:00.000Z"),
    });

    await run(fetch, store, extract);

    expect(marks.get("example_ai")).toEqual(new Date("2026-11-08T03:00:00.000Z"));
  });

  describe("a story linking to the source's own site", () => {
    const ownSiteStories = (ownUrl: string) => vi.fn(async () => [story({ url: ownUrl }), story({ url: "https://example.org/news" })]);
    const monday = () => site({ monday: page("monday", "2026-11-09T03:00:00.000Z") });

    it("is dropped", async () => {
      const { store, rows } = memoryStore();
      await run(monday(), store, ownSiteStories("https://news.example.org/p/older"));
      expect([...rows.values()].map((row) => row.url)).toEqual(["https://example.org/news"]);
    });

    it("counts as a story without a link", async () => {
      const result = await run(monday(), memoryStore().store, ownSiteStories("https://news.example.org/p/older"));
      expect(result.sources[0]).toMatchObject({ stories: 1, skippedNoLink: 1 });
    });

    it("is dropped when the link adds www.", async () => {
      const result = await run(monday(), memoryStore().store, ownSiteStories("https://www.news.example.org/p/older"));
      expect(result.sources[0]).toMatchObject({ stories: 1, skippedNoLink: 1 });
    });

    it("is dropped when the siteUrl has www. and the link does not", async () => {
      const wwwSite: StorySource = { ...SITE, siteUrl: "https://www.news.example.org" };
      const url = "https://www.news.example.org/p/monday";
      const fetch = fakeFetch({
        "https://www.news.example.org/sitemap.xml": () => new Response(`<urlset><url><loc>${url}</loc><lastmod>2026-11-09</lastmod></url></urlset>`),
        [url]: () => new Response(page("monday", "2026-11-09T03:00:00.000Z")),
      });
      const result = await ingestStories({
        gmail: fakeGmail([]).gmail,
        fetch,
        extract: ownSiteStories("https://news.example.org/p/older"),
        store: memoryStore().store,
        now: NOW,
        sources: [wwwSite],
      });
      expect(result.sources[0]).toMatchObject({ stories: 1, skippedNoLink: 1 });
    });
  });

  it("reads posts listed under the site's www. host", async () => {
    const url = "https://www.news.example.org/p/monday";
    const fetch = fakeFetch({
      [SITEMAP_URL]: () => new Response(`<urlset><url><loc>${url}</loc><lastmod>2026-11-09</lastmod></url></urlset>`),
      [url]: () => new Response(page("monday", "2026-11-09T03:00:00.000Z")),
    });
    const result = await run(fetch, memoryStore().store);
    expect(result.sources[0]).toMatchObject({ status: "ok", documents: 1 });
  });

  it("sends the browser User-Agent and a timeout with every request", async () => {
    const fetch = site({ monday: page("monday", "2026-11-09T03:00:00.000Z") });
    await run(fetch, memoryStore().store, vi.fn(async () => []));
    const calls = fetch.mock.calls.filter(([input]) => String(input).startsWith("https://news.example.org/"));
    expect(calls).toHaveLength(2);
    for (const [, init] of calls as unknown as [string, RequestInit][]) {
      expect(init.headers).toEqual({ "user-agent": BROWSER_USER_AGENT });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("reports a sitemap HTTP error as a failed source", async () => {
    const { store } = memoryStore();
    const fetch = fakeFetch({ [SITEMAP_URL]: () => new Response("", { status: 503 }) });
    const result = await run(fetch, store);
    expect(result.sources[0]).toMatchObject({ status: "failed", errors: ["Example AI sitemap returned HTTP 503."] });
    expect(store.writeBookmark).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty sitemap", "<urlset></urlset>"],
    ["only another host", sitemap([{ slug: "x", lastmod: "2026-11-09", host: "other.example.org" }])],
    ["a sitemap index", "<sitemapindex><sitemap><loc>https://news.example.org/sitemap-1.xml</loc></sitemap></sitemapindex>"],
  ])("fails when the sitemap lists no posts: %s", async (_, xml) => {
    const fetch = fakeFetch({ [SITEMAP_URL]: () => new Response(xml) });
    const result = await run(fetch, memoryStore().store);
    expect(result.sources[0]).toMatchObject({ status: "failed", errors: ["Example AI sitemap lists no posts."] });
  });

  it("reads only posts with a lastmod on or after the cutoff day, on the site's host", async () => {
    const fetch = site({}, [
      { slug: "recent", lastmod: "2026-11-06" },
      { slug: "old", lastmod: "2026-11-05" },
      { slug: "undated" },
      { slug: "elsewhere", lastmod: "2026-11-09", host: "other.example.org" },
    ]);

    await run(fetch, memoryStore().store, vi.fn(async () => []));

    const pages = fetch.mock.calls.map(([input]) => String(input)).filter((href) => href.includes("/p/"));
    // The cutoff is 2026-11-06 14:55 UTC, so lastmod 2026-11-06 onward counts.
    expect(pages).toEqual([`${PAGE}recent`]);
  });

  describe("more changed posts than the page cap", () => {
    const changed = BEEHIIV_PAGE_LIMIT + 2;
    const entries = Array.from({ length: changed }, (_, index) => ({ slug: `p${index}`, lastmod: index < 2 ? "2026-11-07" : "2026-11-09" }));
    const overflow = `Example AI: ${changed} posts changed since 2026-11-06; read ${BEEHIIV_PAGE_LIMIT}. New posts may be among the unread ones.`;
    const pages = (publishedAt: string) => Object.fromEntries(entries.map(({ slug }) => [slug, page(slug, publishedAt)]));

    const read = (fetch: ReturnType<typeof site>) =>
      fetch.mock.calls.map(([input]) => String(input)).filter((href) => href.startsWith(PAGE));

    it("reads the newest by lastmod", async () => {
      const fetch = site(pages("2026-11-05T03:00:00.000Z"), [entries[0], ...entries.slice(2), entries[1]]);
      await run(fetch, memoryStore().store);
      expect(read(fetch)).toEqual(entries.slice(2).map(({ slug }) => `${PAGE}${slug}`));
    });

    it("breaks lastmod ties by sitemap order", async () => {
      const sameDay = entries.map(({ slug }) => ({ slug, lastmod: "2026-11-09" }));
      const fetch = site(pages("2026-11-05T03:00:00.000Z"), sameDay);
      await run(fetch, memoryStore().store);
      expect(read(fetch)).toEqual(sameDay.slice(0, BEEHIIV_PAGE_LIMIT).map(({ slug }) => `${PAGE}${slug}`));
    });

    it("is partial when new posts were saved, and keeps the bookmark", async () => {
      const { store } = memoryStore();
      const result = await run(site(pages("2026-11-09T03:00:00.000Z"), entries), store, vi.fn(async () => []));
      expect(result.sources[0]).toMatchObject({ status: "partial", errors: [overflow] });
      expect(store.writeBookmark).not.toHaveBeenCalled();
    });

    it("is failed when nothing read was new", async () => {
      const result = await run(site(pages("2026-11-05T03:00:00.000Z"), entries), memoryStore().store);
      expect(result.sources[0]).toMatchObject({ status: "failed", documents: 1, errors: [overflow] });
    });
  });
});
