import { describe, expect, it, vi } from "vitest";

// The real services' article reader, with a fake web and saved copies in memory (no network, no database).
const articleWeb = vi.hoisted(() => ({ routes: {} as Record<string, unknown>, fetch: null as null | { mock: { calls: unknown[][] } } }));
const articleStore = vi.hoisted(() => ({ findRead: vi.fn(), save: vi.fn(), clearOldText: vi.fn() }));
vi.mock("@/src/pipeline/draft/articles/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/pipeline/draft/articles/http")>();
  const { fakeWeb } = await import("@/src/pipeline/draft/articles/fake-web.fixture");
  return {
    ...actual,
    createNodeFetch: () => {
      const web = fakeWeb(articleWeb.routes as never);
      articleWeb.fetch = web.fetch;
      return web.fetch;
    },
  };
});
vi.mock("@/src/pipeline/draft/articles/article-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/articles/article-store")>()),
  prismaArticleStore: articleStore,
}));

import type { ArticleReadReport } from "@/src/pipeline/draft/articles";
import { htmlPage, jinaAnswer, jinaUrl, prose } from "@/src/pipeline/draft/articles/fake-web.fixture";
import type { WrittenIssueContent } from "@/src/pipeline/draft/content";
import { SAMPLE_APPROVED, SAMPLE_CONTENT, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import { FeaturedImageError } from "@/src/pipeline/draft/image/featured-image";
import {
  createDraftDeps,
  DRAFT_STEPS,
  DraftStepError,
  produceDraft,
  readNoArticles,
  type DraftStep,
  type ProduceDraftDeps,
  type ProduceDraftInput,
  type ReadArticles,
} from "@/src/pipeline/draft/produce-draft";
import type { IssueWriter } from "@/src/pipeline/draft/writer";
import { parseSentEmail } from "@/src/pipeline/publish/sent-email-parser";

const IMAGE_URL = "https://assets.example.test/newsletter-dev/2027-01-04-abc.jpg";

const INPUT: ProduceDraftInput = {
  outline: SAMPLE_OUTLINE,
  stories: SAMPLE_APPROVED,
  issue: { id: 301, date: "2027-01-04" },
  draft: { id: 41 },
};

function fakeDeps(overrides: Partial<ProduceDraftDeps> = {}) {
  const steps: DraftStep[] = [];
  const deps = {
    readArticles: vi.fn<ReadArticles>(readNoArticles),
    writer: vi.fn(async () => structuredClone(SAMPLE_CONTENT)),
    makeImage: vi.fn(async () => ({ imageUrl: IMAGE_URL, scenePrompt: "A pretend robot folds towels." })),
    onStep: vi.fn(async (step: DraftStep) => {
      steps.push(step);
    }),
    ...overrides,
  } satisfies ProduceDraftDeps;
  return { deps, steps };
}

async function failure(promise: Promise<unknown>): Promise<DraftStepError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DraftStepError);
  return error as DraftStepError;
}

describe("produceDraft", () => {
  it("runs read articles, write, validate, image, and html, in that order, reporting each step", async () => {
    const { deps, steps } = fakeDeps();

    const draft = await produceDraft(INPUT, deps);

    expect(DRAFT_STEPS).toEqual(["read_articles", "write", "validate", "image", "html"]);
    expect(steps).toEqual(DRAFT_STEPS);
    expect(draft).toEqual({
      content: SAMPLE_CONTENT,
      html: expect.stringContaining('data-draft-id="41"'),
      featuredImageUrl: IMAGE_URL,
      scenePrompt: "A pretend robot folds towels.",
      unreadStoryIds: [501, 502, 503, 504],
      stepMs: expect.any(Object),
    });
    expect(Object.keys(draft.stepMs)).toEqual(DRAFT_STEPS);
  });

  it("makes no email in the distribution service: it has no GHL step and returns no template", async () => {
    const { deps, steps } = fakeDeps();

    const draft = await produceDraft(INPUT, deps);

    expect(DRAFT_STEPS).not.toContain("ghl");
    expect(steps).not.toContain("ghl");
    expect(draft).not.toHaveProperty("ghlTemplateId");
    expect(draft).not.toHaveProperty("ghlPreviewUrl");
    expect(draft).not.toHaveProperty("ghlMode");
  });

  it("writes from the outline's sections and lead story, and the articles it read", async () => {
    const readArticles = vi.fn<ReadArticles>(async () => [
      { storyId: 501, text: "Synthetic article text." },
      { storyId: 502, unread: true as const },
    ]);
    const { deps } = fakeDeps({ readArticles });

    const draft = await produceDraft(INPUT, deps);

    // Only feature-section stories are read (#120).
    expect(readArticles.mock.calls[0][0].map((story) => story.id)).toEqual([501, 502, 503, 504]);
    // The saved copies record the issue, so their text can be cleared after it is published.
    expect(readArticles.mock.calls[0][1]).toEqual({ issueId: 301 });
    expect(deps.writer).toHaveBeenCalledWith({
      sections: SAMPLE_APPROVED,
      leadStoryId: 501,
      articles: [
        { storyId: 501, text: "Synthetic article text." },
        { storyId: 502, unread: true },
      ],
    });
    expect(draft.unreadStoryIds).toEqual([502, 503, 504]);
  });

  it("readNoArticles (tests, and replay --no-read) marks every feature-section story unread", async () => {
    await expect(readNoArticles(SAMPLE_APPROVED.headlines)).resolves.toEqual([
      { storyId: 501, unread: true },
      { storyId: 502, unread: true },
    ]);
  });

  it("makes the image from the title and top stories, and renders the email with the issue and draft ids", async () => {
    const { deps } = fakeDeps();

    const draft = await produceDraft(INPUT, deps);

    expect(deps.makeImage).toHaveBeenCalledWith({
      issueDate: "2027-01-04",
      context: {
        subjectLine: SAMPLE_CONTENT.title,
        topStories: SAMPLE_CONTENT.headlines.map((story) => ({ headline: story.headline, detail: story.story_detail })),
      },
    });
    const parsed = parseSentEmail(draft.html);
    expect(parsed?.content.issue_id).toBe(301);
    expect(parsed?.draftId).toBe(41);
    // Only a staged version's email names a version (#149).
    expect(parsed?.versionId).toBeNull();
    expect(draft.html).toContain(IMAGE_URL);
  });

  const badTitle: WrittenIssueContent = { ...SAMPLE_CONTENT, title: "Too short" };
  // Validate failures write twice, so they have their own tests below.
  const failures: Array<[DraftStep, Partial<ProduceDraftDeps>, Partial<ProduceDraftInput>, string]> = [
    ["read_articles", { readArticles: vi.fn(async () => Promise.reject(new Error("reader down"))) }, {}, "reader down"],
    ["write", { writer: vi.fn(async () => Promise.reject(new Error("The writer refused: no."))) }, {}, "The writer refused: no."],
    [
      "image",
      { makeImage: vi.fn(async () => Promise.reject(new FeaturedImageError("upload", new Error("S3 returned HTTP 403.")))) },
      {},
      "Featured image failed at upload: S3 returned HTTP 403.",
    ],
    ["html", {}, { issue: { id: 301, date: "2027-13-40" } }, 'Issue date "2027-13-40" is not a YYYY-MM-DD date.'],
  ];

  it.each(failures)("fails at %s with that step and a plain error, and runs no later step", async (step, overrides, input, message) => {
    const { deps, steps } = fakeDeps(overrides);

    const error = await failure(produceDraft({ ...INPUT, ...input }, deps));

    expect(error.step).toBe(step);
    expect(error.message).toContain(message);
    expect(steps).toEqual(DRAFT_STEPS.slice(0, DRAFT_STEPS.indexOf(step) + 1));
  });

  it("keeps what it had made when a later step fails: the content and unread stories, then the image", async () => {
    const { deps } = fakeDeps();

    const error = await failure(produceDraft({ ...INPUT, issue: { id: 301, date: "2027-13-40" } }, deps));

    expect(error.step).toBe("html");
    expect(error.partial).toEqual({
      content: SAMPLE_CONTENT,
      unreadStoryIds: [501, 502, 503, 504],
      featuredImageUrl: IMAGE_URL,
      scenePrompt: "A pretend robot folds towels.",
    });
    expect(Object.keys(error.stepMs)).toEqual(DRAFT_STEPS);
  });

  it("keeps the written content when the checks fail, so the owner can see what to fix", async () => {
    const { deps } = fakeDeps({ writer: vi.fn(async () => structuredClone(badTitle)) });

    const error = await failure(produceDraft(INPUT, deps));

    expect(error.partial.content).toEqual(badTitle);
    expect(error.partial.unreadStoryIds).toEqual([501, 502, 503, 504]);
  });

  describe("when the written issue fails its checks", () => {
    // The writer varies from run to run: a story it left out once is usually there on a second try.
    const missingStory: WrittenIssueContent = {
      ...SAMPLE_CONTENT,
      research_and_analysis: SAMPLE_CONTENT.research_and_analysis.filter((story) => story.story_id !== 504),
    };
    const MISSING_PROBLEM = "Story 504 (Research & Analysis) is missing.";

    function writerReturning(...results: WrittenIssueContent[]) {
      const writer = vi.fn<IssueWriter>(async () => structuredClone(SAMPLE_CONTENT));
      for (const result of results) writer.mockImplementationOnce(async () => structuredClone(result));
      return writer;
    }

    it("writes once more, and goes on as normal when the rewrite passes", async () => {
      const onRewrite = vi.fn();
      const { deps, steps } = fakeDeps({ writer: writerReturning(missingStory, SAMPLE_CONTENT), onRewrite });

      const draft = await produceDraft(INPUT, deps);

      expect(deps.writer).toHaveBeenCalledTimes(2);
      expect(onRewrite).toHaveBeenCalledTimes(1);
      expect(onRewrite).toHaveBeenCalledWith(1);
      expect(steps).toEqual(["read_articles", "write", "validate", "write", "validate", "image", "html"]);
      expect(draft.content).toEqual(SAMPLE_CONTENT);
      expect(deps.makeImage).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ subjectLine: SAMPLE_CONTENT.title }) }));
    });

    it("gives the rewrite the same stories, its previous draft, and every problem the checks found", async () => {
      const writer = writerReturning(missingStory, SAMPLE_CONTENT);
      const { deps } = fakeDeps({ writer });

      await produceDraft(INPUT, deps);

      const [first, second] = writer.mock.calls.map(([input]) => input);
      expect(first.revision).toBeUndefined();
      expect(second).toEqual({ ...first, revision: { previous: missingStory, problems: [MISSING_PROBLEM] } });
    });

    it("fails at validate as before when the rewrite fails the checks too, keeping the rewrite", async () => {
      const stillShort: WrittenIssueContent = { ...SAMPLE_CONTENT, title: "Still too short" };
      const { deps, steps } = fakeDeps({ writer: writerReturning(missingStory, stillShort) });

      const error = await failure(produceDraft(INPUT, deps));

      expect(deps.writer).toHaveBeenCalledTimes(2);
      expect(error.step).toBe("validate");
      expect(error.message).toBe('The written issue failed 1 check: The title has 3 words; it needs 4 to 8: "Still too short".');
      expect(error.partial.content).toEqual(stillShort);
      expect(steps).toEqual(["read_articles", "write", "validate", "write", "validate"]);
      expect(deps.makeImage).not.toHaveBeenCalled();
    });

    it("does not rewrite a draft that passes the first time", async () => {
      const onRewrite = vi.fn();
      const { deps } = fakeDeps({ onRewrite });

      await produceDraft(INPUT, deps);

      expect(deps.writer).toHaveBeenCalledTimes(1);
      expect(onRewrite).not.toHaveBeenCalled();
    });

    it("counts both writes in the write step's time", async () => {
      let clock = 0;
      const results = [missingStory, SAMPLE_CONTENT];
      const writer = vi.fn<IssueWriter>(async () => {
        clock += 100;
        return structuredClone(results.shift()!);
      });
      const { deps } = fakeDeps({ writer, now: () => clock });

      const draft = await produceDraft(INPUT, deps);

      expect(draft.stepMs.write).toBe(200);
    });

    it("stops the rewrite at the deadline, keeping the first draft", async () => {
      const deadline = new AbortController();
      const writer = vi.fn<IssueWriter>(async () => structuredClone(missingStory));
      writer.mockImplementationOnce(async () => structuredClone(missingStory));
      writer.mockImplementationOnce(() => {
        deadline.abort(new Error("The draft timed out after 13 min."));
        return new Promise<never>(() => undefined);
      });
      const { deps } = fakeDeps({ writer, signal: deadline.signal });

      const error = await failure(produceDraft(INPUT, deps));

      expect(error.step).toBe("write");
      expect(error.message).toBe("The draft timed out after 13 min.");
      expect(error.partial.content).toEqual(missingStory);
    });
  });

  it("fails the running step as soon as the deadline passes, without waiting for it", async () => {
    const deadline = new AbortController();
    const { deps, steps } = fakeDeps({
      makeImage: vi.fn(() => {
        deadline.abort(new Error("The draft timed out after 13 min."));
        return new Promise<never>(() => undefined);
      }),
      signal: deadline.signal,
    });

    const error = await failure(produceDraft(INPUT, deps));

    expect(error.step).toBe("image");
    expect(error.message).toBe("The draft timed out after 13 min.");
    expect(error.partial.content).toEqual(SAMPLE_CONTENT);
    expect(steps).toEqual(["read_articles", "write", "validate", "image"]);
    expect(error.partial.html).toBeUndefined();
  });
});

describe("createDraftDeps", () => {
  const [planner, laundry] = SAMPLE_APPROVED.headlines;
  const [paperOne, paperTwo] = SAMPLE_APPROVED.research;

  it("reads articles with the article reader (#120): saved copies first, then the web, saving and reporting each story", async () => {
    articleWeb.routes = {
      [planner.url]: htmlPage(prose("planner")),
      [laundry.url]: htmlPage("Forbidden", 403),
      [jinaUrl(laundry.url)]: jinaAnswer(laundry.url, prose("laundry")),
      [paperTwo.url]: htmlPage("Gone", 410),
    };
    articleStore.findRead.mockReset().mockResolvedValue([
      { storyId: paperOne.id, url: paperOne.url, status: "read", method: "fetch", text: "A saved pretend paper.", finalUrl: paperOne.url, chars: 22, ms: 50, error: null, attempts: [], readAt: new Date("2027-01-03T12:00:00.000Z") },
    ]);
    articleStore.save.mockReset().mockResolvedValue(undefined);
    articleStore.clearOldText.mockReset().mockResolvedValue(1);
    const onArticleReads = vi.fn<(reads: ArticleReadReport[]) => void>();
    const onArticleInfo = vi.fn<(message: string) => void>();

    const deps = createDraftDeps({ APP_ENV: "development", JINA_API_KEY: "jina-test-key" }, { onArticleReads, onArticleInfo });
    const articles = await deps.readArticles([planner, laundry, paperOne, paperTwo], { issueId: 301 });

    expect(articles).toEqual([
      { storyId: planner.id, text: expect.stringContaining("planner pretend lab") },
      { storyId: laundry.id, text: expect.stringContaining("laundry pretend lab") },
      { storyId: paperOne.id, text: "A saved pretend paper." },
      { storyId: paperTwo.id, unread: true },
    ]);
    expect(articleStore.findRead).toHaveBeenCalledWith([planner, laundry, paperOne, paperTwo].map((story) => ({ storyId: story.id, url: story.url })));
    const jinaCall = articleWeb.fetch?.mock.calls.find(([url]) => url === jinaUrl(laundry.url)) as [string, { headers: Record<string, string> }];
    expect(jinaCall[1].headers.Authorization).toBe("Bearer jina-test-key");
    expect(articleStore.save.mock.calls[0][0].map((read: { storyId: number; status: string; method: string | null }) => [read.storyId, read.status, read.method])).toEqual([
      [planner.id, "read", "fetch"],
      [laundry.id, "read", "jina"],
      [paperTwo.id, "failed", null],
    ]);
    expect(articleStore.save.mock.calls[0][2]).toEqual({ issueId: 301 });
    expect(onArticleInfo).toHaveBeenCalledWith(expect.stringMatching(/^Cleared the saved text of 1 old article /));
    expect(onArticleReads.mock.calls[0][0].map((read) => [read.storyId, read.reused])).toEqual([
      [planner.id, false],
      [laundry.id, false],
      [paperOne.id, true],
      [paperTwo.id, false],
    ]);
  });

  it("gives the article reader, the writer, and the image maker, and nothing that calls the distribution service", () => {
    const deps = createDraftDeps({ APP_ENV: "production" });

    expect(Object.keys(deps).sort()).toEqual(["makeImage", "readArticles", "writer"]);
  });

  it("is not the no-read stand-in", () => {
    expect(createDraftDeps({ APP_ENV: "development" }).readArticles).not.toBe(readNoArticles);
  });
});
