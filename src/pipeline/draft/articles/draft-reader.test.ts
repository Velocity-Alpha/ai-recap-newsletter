import { describe, expect, it, vi } from "vitest";

import type { ArticleStore, SavedArticleRead } from "@/src/pipeline/draft/articles/article-store";
import {
  articleReadLogData,
  createDraftArticleReader,
  describeArticleRead,
  readerOptionsFromEnv,
  summarizeArticleReads,
  type ArticleReadReport,
} from "@/src/pipeline/draft/articles/draft-reader";
import { fakeWeb, htmlPage, jinaUrl, prose } from "@/src/pipeline/draft/articles/fake-web.fixture";
import type { StoryArticleRead } from "@/src/pipeline/draft/articles/read-articles";
import type { ApprovedStory } from "@/src/pipeline/draft/content";

const NOW = new Date("2027-01-04T15:00:00.000Z");

function story(id: number, url: string): ApprovedStory {
  return { id, url, headline: `Pretend story ${id}`, summary: "A made-up summary.", storyDetails: null, note: "" };
}

/** Behaves like story_articles: keyed by story and link, and only read copies are found. */
function memoryStore() {
  const rows = new Map<string, SavedArticleRead>();
  const store: ArticleStore = {
    findRead: vi.fn(async (keys: Array<{ storyId: number; url: string }>) =>
      keys.flatMap((key) => {
        const row = rows.get(`${key.storyId} ${key.url}`);
        return row && row.status === "read" ? [structuredClone(row)] : [];
      }),
    ),
    save: vi.fn(async (reads: StoryArticleRead[], now: Date) => {
      for (const read of reads) rows.set(`${read.storyId} ${read.url}`, { ...structuredClone(read), readAt: now });
    }),
  };
  return { store, rows };
}

const A = "https://news.example.com/a";
const B = "https://news.example.com/b";
const EDITED = "https://news.example.com/a-edited";

describe("createDraftArticleReader", () => {
  it("reads each story once: a later commit reuses the saved copy and reads only new stories", async () => {
    const web = fakeWeb({ [A]: htmlPage(prose("alpha")), [B]: htmlPage(prose("beta")) });
    const { store } = memoryStore();
    const reports: ArticleReadReport[][] = [];
    const reader = createDraftArticleReader({ store, readOptions: { fetch: web.fetch }, onReads: (reads) => void reports.push(reads), now: () => NOW });

    const first = await reader([story(1, A)]);
    // A later commit moves story 2 into a feature section.
    const second = await reader([story(1, A), story(2, B)]);

    expect(first).toEqual([{ storyId: 1, text: expect.stringContaining("alpha pretend lab") }]);
    expect(second).toEqual([
      { storyId: 1, text: expect.stringContaining("alpha pretend lab") },
      { storyId: 2, text: expect.stringContaining("beta pretend lab") },
    ]);
    expect(web.calls).toEqual([A, B]);
    expect(reports[1].map(({ storyId, reused, status }) => ({ storyId, reused, status }))).toEqual([
      { storyId: 1, reused: true, status: "read" },
      { storyId: 2, reused: false, status: "read" },
    ]);
  });

  it("reads a link edited on the board again", async () => {
    const web = fakeWeb({ [A]: htmlPage(prose("alpha")), [EDITED]: htmlPage(prose("edited")) });
    const { store } = memoryStore();
    const reader = createDraftArticleReader({ store, readOptions: { fetch: web.fetch }, now: () => NOW });

    await reader([story(1, A)]);
    const articles = await reader([story(1, EDITED)]);

    expect(web.calls).toEqual([A, EDITED]);
    expect(articles).toEqual([{ storyId: 1, text: expect.stringContaining("edited pretend lab") }]);
  });

  it("saves unread stories too, and tries them again on the next commit", async () => {
    const web = fakeWeb({ [A]: htmlPage("Forbidden", 403), [jinaUrl(A)]: htmlPage("Bad gateway", 502) });
    const { store, rows } = memoryStore();
    const reader = createDraftArticleReader({ store, readOptions: { fetch: web.fetch }, now: () => NOW });

    await expect(reader([story(1, A)])).resolves.toEqual([{ storyId: 1, unread: true }]);
    expect(rows.get(`1 ${A}`)).toMatchObject({ status: "blocked", text: null, readAt: NOW });

    await reader([story(1, A)]);
    expect(web.calls.filter((url) => url === A)).toHaveLength(2);
  });

  it("goes on reading when the saved copies cannot be loaded or saved, and warns", async () => {
    const web = fakeWeb({ [A]: htmlPage(prose("alpha")) });
    const store: ArticleStore = {
      findRead: vi.fn(async () => Promise.reject(new Error('relation "story_articles" does not exist'))),
      save: vi.fn(async () => Promise.reject(new Error("connection reset"))),
    };
    const onWarning = vi.fn();
    const reader = createDraftArticleReader({ store, readOptions: { fetch: web.fetch }, onWarning, now: () => NOW });

    await expect(reader([story(1, A)])).resolves.toEqual([{ storyId: 1, text: expect.stringContaining("alpha") }]);
    expect(onWarning.mock.calls.map(([message]) => message)).toEqual([
      'Could not load saved articles, so every story was read: relation "story_articles" does not exist',
      "Could not save the articles read: connection reset",
    ]);
  });

  it("reads every story and saves nothing without a store (the replay script)", async () => {
    const web = fakeWeb({ [A]: htmlPage(prose("alpha")) });
    const reader = createDraftArticleReader({ store: null, readOptions: { fetch: web.fetch } });
    await expect(reader([story(1, A)])).resolves.toEqual([{ storyId: 1, text: expect.stringContaining("alpha") }]);
  });
});

describe("readerOptionsFromEnv", () => {
  it("is the one place that reads the optional reader keys", () => {
    expect(readerOptionsFromEnv({ JINA_API_KEY: " jina-key ", GITHUB_TOKEN: "gh-token" })).toEqual({ jinaApiKey: "jina-key", githubToken: "gh-token" });
    expect(readerOptionsFromEnv({ JINA_API_KEY: " ", OTHER: "x" })).toEqual({ jinaApiKey: undefined, githubToken: undefined });
  });
});

describe("describeArticleRead and summarizeArticleReads", () => {
  const base = { url: A, finalUrl: A, attempts: [], error: null, text: "x" };
  const reads: ArticleReadReport[] = [
    { ...base, storyId: 1, status: "read", method: "fetch", chars: 5_412, ms: 820, reused: false },
    { ...base, storyId: 2, status: "read", method: "arxiv", chars: 48_000, ms: 2_000, reused: true, readAt: new Date("2027-01-03T15:00:00.000Z") },
    { ...base, storyId: 3, status: "blocked", method: null, text: null, chars: 0, ms: 12_345, reused: false, error: "fetch: HTTP 403. jina: A bot check or block page." },
  ];

  it("says how each story was read, or why it was not", () => {
    expect(reads.map(describeArticleRead)).toEqual([
      "Story 1: read with fetch in 0.8 s (5,412 characters).",
      "Story 2: used the copy read with arxiv on 2027-01-03 (48,000 characters).",
      "Story 3: not read (blocked) after 12.3 s. fetch: HTTP 403. jina: A bot check or block page.",
    ]);
  });

  it("logs each story's outcome without the article text", () => {
    expect(articleReadLogData(reads[2])).toEqual({
      storyId: 3,
      url: A,
      status: "blocked",
      method: null,
      reused: false,
      ms: 12_345,
      chars: 0,
      finalUrl: A,
      error: "fetch: HTTP 403. jina: A bot check or block page.",
      attempts: [],
    });
    expect(articleReadLogData(reads[0])).not.toHaveProperty("text");
  });

  it("sums up the step", () => {
    expect(summarizeArticleReads(reads)).toBe("Read 2 of 3 articles (1 saved copy reused). Not read: story 3.");
    expect(summarizeArticleReads([])).toBe("No feature-section stories to read.");
  });
});
