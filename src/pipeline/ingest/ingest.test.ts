import { describe, expect, it, vi } from "vitest";

import type { ExtractedStory, ExtractionInput, Extractor } from "@/src/pipeline/ingest/extract";
import { ingestStories, type IngestStore, type StoryRow } from "@/src/pipeline/ingest/ingest";
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
    expect(result.sources[0]).toMatchObject({ source: "rundown_ai", status: "ok", items: 2, stories: 2, skippedNoLink: 1 });
    expect(result.storiesSaved).toBe(2);
  });

  it("never looks back more than 72 hours, and ignores mail at or before the bookmark", async () => {
    const { store } = memoryStore({ rundown_ai: new Date(NOW.getTime() - 10 * 24 * HOUR) });
    const { gmail, listMessageIds } = fakeGmail([]);
    const result = await ingestStories({ gmail, fetch: fakeFetch(), extract: vi.fn(), store, now: NOW, sources: [RUNDOWN] });

    const since = Math.floor((NOW.getTime() - 72 * HOUR) / 1000);
    expect(listMessageIds).toHaveBeenCalledWith(`from:news@daily.therundown.ai after:${since}`, 20);
    expect(result.sources[0]).toMatchObject({ status: "no_new", items: 0 });
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
    expect(result.sources[0]).toMatchObject({ status: "partial", items: 3, stories: 2 });
    expect(result.sources[0].errors).toEqual(["broken: Extraction failed twice: model output is not valid JSON."]);
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
    expect(result.sources[0]).toMatchObject({ status: "ok", items: 1, stories: 1 });
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

  function sitemap(entries: { slug: string; lastmod?: string; host?: string }[]) {
    const urls = entries
      .map(({ slug, lastmod, host }) => `<url><loc>https://${host ?? "news.example.org"}/p/${slug}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`)
      .join("");
    return `<urlset><url><loc>https://news.example.org/</loc><lastmod>2026-11-09</lastmod></url>${urls}</urlset>`;
  }

  function post(slug: string, publishedAt: string, options: { free?: string; body?: string } = {}) {
    const body = options.body ?? `<div id="content-blocks"><p>body of ${slug}</p></div>`;
    return () =>
      new Response(
        `<script type="application/ld+json">{"@type":"Article","datePublished":"${publishedAt}","isAccessibleForFree":"${options.free ?? "True"}"}</script>${body}`,
      );
  }

  const extractFromBody = () =>
    vi.fn(async (input: ExtractionInput) => [story({ published_at: "2026-11-08", url: `https://example.org/${input.text.split(" ").pop()}` })]);

  const run = (fetch: typeof globalThis.fetch, store: IngestStore, extract: Extractor = extractFromBody()) =>
    ingestStories({ gmail: fakeGmail([]).gmail, fetch, extract, store, now: NOW, sources: [SITE] });

  it("saves stories with their own day, passes the New York issue date, and moves the bookmark to datePublished", async () => {
    const { store, rows, marks } = memoryStore({ example_ai: new Date(NOW.getTime() - 48 * HOUR) });
    const fetch = fakeFetch({
      [SITEMAP_URL]: () => new Response(sitemap([{ slug: "monday", lastmod: "2026-11-09" }])),
      [`${PAGE}monday`]: post("monday", "2026-11-09T03:01:00.000Z"),
    });
    const extract = extractFromBody();

    const result = await run(fetch, store, extract);

    expect(extract.mock.calls[0][0]).toMatchObject({ sourceDate: "2026-11-08", text: "body of monday" });
    expect([...rows.values()]).toEqual([expect.objectContaining({ day: "2026-11-08", source: "example_ai", url: "https://example.org/monday" })]);
    expect(marks.get("example_ai")).toEqual(new Date("2026-11-09T03:01:00.000Z"));
    expect(result.sources[0]).toMatchObject({ status: "ok", items: 1, stories: 1 });
  });

  it("skips posts at or before the bookmark and paid posts, even without a body, and calls no model", async () => {
    const bookmark = new Date("2026-11-09T03:01:00.000Z");
    const { store } = memoryStore({ example_ai: bookmark });
    const fetch = fakeFetch({
      [SITEMAP_URL]: () =>
        new Response(sitemap([{ slug: "seen", lastmod: "2026-11-09" }, { slug: "paid", lastmod: "2026-11-09" }, { slug: "locked", lastmod: "2026-11-09" }])),
      [`${PAGE}seen`]: post("seen", bookmark.toISOString()),
      [`${PAGE}paid`]: post("paid", "2026-11-09T05:00:00.000Z", { free: "False" }),
      [`${PAGE}locked`]: post("locked", "2026-11-09T06:00:00.000Z", { free: "False", body: "<div>Subscribe to read</div>" }),
    });
    const extract = vi.fn();

    const result = await run(fetch, store, extract);

    expect(extract).not.toHaveBeenCalled();
    expect(store.writeBookmark).not.toHaveBeenCalled();
    expect(result.sources[0]).toMatchObject({ status: "no_new", items: 0, errors: [] });
  });

  it("does not move the bookmark when any page fails, but saves the good posts", async () => {
    const { store, rows } = memoryStore({ example_ai: new Date(NOW.getTime() - 48 * HOUR) });
    const fetch = fakeFetch({
      [SITEMAP_URL]: () => new Response(sitemap([{ slug: "good", lastmod: "2026-11-08" }, { slug: "broken", lastmod: "2026-11-09" }])),
      [`${PAGE}good`]: post("good", "2026-11-08T03:00:00.000Z"),
      [`${PAGE}broken`]: () => new Response("gone", { status: 500 }),
    });

    const result = await run(fetch, store);

    expect([...rows.values()].map((row) => row.url)).toEqual(["https://example.org/good"]);
    expect(result.sources[0]).toMatchObject({ status: "partial", items: 2, stories: 1, errors: [`${PAGE}broken: HTTP 500.`] });
    expect(store.writeBookmark).not.toHaveBeenCalled();
  });

  it("reports a free post with no body as a failed item", async () => {
    const { store } = memoryStore();
    const fetch = fakeFetch({
      [SITEMAP_URL]: () => new Response(sitemap([{ slug: "empty", lastmod: "2026-11-09" }])),
      [`${PAGE}empty`]: post("empty", "2026-11-09T03:00:00.000Z", { body: "<div>moved</div>" }),
    });
    const result = await run(fetch, store);
    expect(result.sources[0]).toMatchObject({ status: "failed", errors: [`${PAGE}empty: beehiiv post has no #content-blocks element.`] });
    expect(store.writeBookmark).not.toHaveBeenCalled();
  });

  it("drops stories that link to the source's own site and counts them as without a link", async () => {
    const { store, rows } = memoryStore();
    const fetch = fakeFetch({
      [SITEMAP_URL]: () => new Response(sitemap([{ slug: "monday", lastmod: "2026-11-09" }])),
      [`${PAGE}monday`]: post("monday", "2026-11-09T03:00:00.000Z"),
    });
    const extract = vi.fn(async () => [story({ url: "https://www.news.example.org/p/older" }), story({ url: "https://example.org/news" })]);

    const result = await run(fetch, store, extract);

    expect([...rows.values()].map((row) => row.url)).toEqual(["https://example.org/news"]);
    expect(result.sources[0]).toMatchObject({ stories: 1, skippedNoLink: 1 });
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

  it("accepts a www. host in a CDATA loc", async () => {
    const url = "https://www.news.example.org/p/monday";
    const fetch = fakeFetch({
      [SITEMAP_URL]: () => new Response(`<urlset><url><loc><![CDATA[${url}]]></loc><lastmod>2026-11-09</lastmod></url></urlset>`),
      [url]: post("monday", "2026-11-09T03:00:00.000Z"),
    });
    const result = await run(fetch, memoryStore().store);
    expect(result.sources[0]).toMatchObject({ status: "ok", items: 1 });
  });

  it("reads only posts with a lastmod on or after the cutoff day, on the site's host", async () => {
    const fetch = fakeFetch({
      [SITEMAP_URL]: () =>
        new Response(
          sitemap([
            { slug: "recent", lastmod: "2026-11-06" },
            { slug: "old", lastmod: "2026-11-05" },
            { slug: "undated" },
            { slug: "elsewhere", lastmod: "2026-11-09", host: "other.example.org" },
          ]),
        ),
    });

    await run(fetch, memoryStore().store, vi.fn(async () => []));

    const pages = fetch.mock.calls.map(([input]) => String(input)).filter((href) => href.includes("/p/"));
    // The cutoff is 2026-11-06 14:55 UTC, so lastmod 2026-11-06 onward counts.
    expect(pages).toEqual([`${PAGE}recent`]);
  });

  it("reads at most 30 pages, newest first, says so, and keeps the bookmark", async () => {
    const { store } = memoryStore();
    const posts = Array.from({ length: 32 }, (_, index) => ({ slug: `p${index}`, lastmod: index < 2 ? "2026-11-07" : "2026-11-09" }));
    const fetch = fakeFetch({
      [SITEMAP_URL]: () => new Response(sitemap(posts)),
      ...Object.fromEntries(posts.map(({ slug }) => [`${PAGE}${slug}`, post(slug, "2026-11-09T03:00:00.000Z")])),
    });

    const result = await run(fetch, store, vi.fn(async () => []));

    const pages = fetch.mock.calls.map(([input]) => String(input)).filter((href) => href.startsWith(PAGE));
    expect(pages.sort()).toEqual(posts.slice(2).map(({ slug }) => `${PAGE}${slug}`).sort());
    expect(result.sources[0]).toMatchObject({
      status: "partial",
      errors: ["Example AI: 32 posts changed since 2026-11-06; read the 30 newest."],
    });
    expect(store.writeBookmark).not.toHaveBeenCalled();
  });
});
