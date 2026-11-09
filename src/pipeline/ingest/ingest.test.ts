import { describe, expect, it, vi } from "vitest";

import type { ExtractedStory, ExtractionInput } from "@/src/pipeline/ingest/extract";
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

const RUNDOWN: StorySource = { key: "rundown_ai", name: "The Rundown", kind: "gmail", sender: "news@daily.therundown.ai", body: "text" };

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
    expect(result.sources[0]).toMatchObject({ source: "rundown_ai", status: "ok", emails: 2, stories: 2, skippedNoLink: 1 });
    expect(result.storiesSaved).toBe(2);
  });

  it("never looks back more than 72 hours, and ignores mail at or before the bookmark", async () => {
    const { store } = memoryStore({ rundown_ai: new Date(NOW.getTime() - 10 * 24 * HOUR) });
    const { gmail, listMessageIds } = fakeGmail([]);
    const result = await ingestStories({ gmail, fetch: fakeFetch(), extract: vi.fn(), store, now: NOW, sources: [RUNDOWN] });

    const since = Math.floor((NOW.getTime() - 72 * HOUR) / 1000);
    expect(listMessageIds).toHaveBeenCalledWith(`from:news@daily.therundown.ai after:${since}`, 20);
    expect(result.sources[0]).toMatchObject({ status: "no_new", emails: 0 });
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
    expect(result.sources[0]).toMatchObject({ status: "partial", emails: 3, stories: 2 });
    expect(result.sources[0].errors).toEqual(["broken: Extraction failed twice: model output is not valid JSON."]);
  });

  it("swaps tracking links before extraction and reads HTML sources as text", async () => {
    const source: StorySource = {
      key: "alphasignal",
      name: "AlphaSignal",
      kind: "gmail",
      sender: "news@alphasignal.ai",
      body: "html",
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
  const PRODUCT_HUNT: StorySource = { key: "product_hunt_ai", name: "Product Hunt", kind: "product_hunt" };
  const HUGGING_FACE: StorySource = { key: "huggingface", name: "Hugging Face", kind: "hugging_face" };
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
    expect(result.sources[0]).toMatchObject({ status: "ok", emails: 1, stories: 1 });
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
