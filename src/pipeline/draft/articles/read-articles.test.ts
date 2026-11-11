import { describe, expect, it, vi } from "vitest";

import { fakeWeb, hang, htmlPage, jinaUrl, prose } from "@/src/pipeline/draft/articles/fake-web.fixture";
import type { FetchLike } from "@/src/pipeline/draft/articles/http";
import { DEFAULT_DEADLINE_MS, readArticles } from "@/src/pipeline/draft/articles/read-articles";

const story = (id: number, url: string) => ({ id, url });

describe("readArticles", () => {
  it("gives the whole step a 120 s deadline by default", () => {
    expect(DEFAULT_DEADLINE_MS).toBe(120_000);
  });

  it("returns text for each story it read and `unread` for the rest, in story order, with each story's diagnostics", async () => {
    const web = fakeWeb({
      "https://news.example.com/a": htmlPage(prose("alpha")),
      "https://news.example.com/b": htmlPage("Nothing much here.", 404),
      [jinaUrl("https://news.example.com/b")]: () => new Response("{}", { status: 422, headers: { "content-type": "application/json" } }),
      "https://other.example.org/c": htmlPage(prose("gamma")),
    });

    const { articles, reads } = await readArticles(
      [story(11, "https://news.example.com/a"), story(12, "https://news.example.com/b"), story(13, "https://other.example.org/c")],
      { fetch: web.fetch },
    );

    expect(articles).toEqual([
      { storyId: 11, text: expect.stringContaining("alpha pretend lab") },
      { storyId: 12, unread: true },
      { storyId: 13, text: expect.stringContaining("gamma pretend lab") },
    ]);
    expect(reads.map(({ storyId, status, method, error }) => ({ storyId, status, method, error }))).toEqual([
      { storyId: 11, status: "read", method: "fetch", error: null },
      { storyId: 12, status: "failed", method: null, error: "fetch: HTTP 404. jina: Jina returned HTTP 422: no reason given" },
      { storyId: 13, status: "read", method: "fetch", error: null },
    ]);
    expect(reads[0]).toMatchObject({ chars: expect.any(Number), ms: expect.any(Number), attempts: [expect.objectContaining({ method: "fetch" })] });
  });

  it("reads every story at once rather than one after another", async () => {
    let running = 0;
    let peak = 0;
    const fetch = vi.fn<FetchLike>(async (url) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
      return htmlPage(prose(url))();
    });
    const stories = Array.from({ length: 8 }, (_, index) => story(index + 1, `https://site-${index}.example.com/story`));

    const { reads } = await readArticles(stories, { fetch });

    expect(peak).toBe(8);
    expect(reads.every((read) => read.status === "read")).toBe(true);
  });

  it("sends at most 2 requests to one host at once", async () => {
    const active = new Map<string, number>();
    let peak = 0;
    const fetch = vi.fn<FetchLike>(async (url) => {
      const host = new URL(url).host;
      active.set(host, (active.get(host) ?? 0) + 1);
      peak = Math.max(peak, active.get(host)!);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active.set(host, active.get(host)! - 1);
      return htmlPage(prose(url))();
    });
    const stories = Array.from({ length: 5 }, (_, index) => story(index + 1, `https://huggingface.co/blog/toy-${index}`));

    await readArticles(stories, { fetch });

    expect(peak).toBe(2);
  });

  it("returns at the deadline: a story still being read comes back unread, with the reason", async () => {
    const web = fakeWeb({ "https://fast.example.com/a": htmlPage(prose("fast")), "https://slow.example.com/b": hang });
    const started = Date.now();

    const { articles, reads } = await readArticles(
      [story(1, "https://fast.example.com/a"), story(2, "https://slow.example.com/b")],
      { fetch: web.fetch, deadlineMs: 40 },
    );

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(articles).toEqual([{ storyId: 1, text: expect.stringContaining("fast pretend lab") }, { storyId: 2, unread: true }]);
    expect(reads[1]).toMatchObject({ status: "failed", error: "fetch: Stopped at the 0.04 s deadline for reading articles." });
    expect(web.calls).not.toContain(jinaUrl("https://slow.example.com/b"));
  });

  it("reads nothing for no stories", async () => {
    const web = fakeWeb({});
    await expect(readArticles([], { fetch: web.fetch })).resolves.toEqual({ articles: [], reads: [] });
    expect(web.fetch).not.toHaveBeenCalled();
  });
});
