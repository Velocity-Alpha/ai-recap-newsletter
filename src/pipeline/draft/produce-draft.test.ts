import { describe, expect, it, vi } from "vitest";

import type { WrittenIssueContent } from "@/src/pipeline/draft/content";
import { SAMPLE_APPROVED, SAMPLE_CONTENT, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import { GhlTemplateError } from "@/src/pipeline/draft/ghl-template";
import { FeaturedImageError } from "@/src/pipeline/draft/image/featured-image";
import {
  DRAFT_STEPS,
  DraftStepError,
  NEW_IMAGE_STEPS,
  produceDraft,
  readNoArticles,
  type DraftStep,
  type NewImageDraftInput,
  type ProduceDraftDeps,
  type ProduceDraftInput,
  type ReadArticles,
} from "@/src/pipeline/draft/produce-draft";
import { parseSentEmail } from "@/src/pipeline/publish/sent-email-parser";

const IMAGE_URL = "https://assets.example.test/newsletter-dev/2027-01-04-abc.jpg";

const INPUT: ProduceDraftInput = {
  outline: SAMPLE_OUTLINE,
  stories: SAMPLE_APPROVED,
  issue: { id: 301, date: "2027-01-04" },
  draft: { id: 41, version: 2 },
};

function fakeDeps(overrides: Partial<ProduceDraftDeps> = {}) {
  const steps: DraftStep[] = [];
  const deps = {
    writer: vi.fn(async () => structuredClone(SAMPLE_CONTENT)),
    makeImage: vi.fn(async () => ({ imageUrl: IMAGE_URL, scenePrompt: "A pretend robot folds towels." })),
    createTemplate: vi.fn(async () => ({ templateId: "tpl-1", previewUrl: "https://preview.example.test/tpl-1", mode: "sent" as const })),
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
  it("runs read articles, write, validate, image, html, and GHL, in that order, reporting each step", async () => {
    const { deps, steps } = fakeDeps();

    const draft = await produceDraft(INPUT, deps);

    expect(DRAFT_STEPS).toEqual(["read_articles", "write", "validate", "image", "html", "ghl"]);
    expect(steps).toEqual(DRAFT_STEPS);
    expect(draft).toMatchObject({
      content: SAMPLE_CONTENT,
      featuredImageUrl: IMAGE_URL,
      scenePrompt: "A pretend robot folds towels.",
      ghlTemplateId: "tpl-1",
      ghlPreviewUrl: "https://preview.example.test/tpl-1",
      ghlMode: "sent",
      unreadStoryIds: [501, 502, 503, 504],
    });
    expect(Object.keys(draft.stepMs)).toEqual(DRAFT_STEPS);
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

  it("marks every feature-section story unread until the article reader exists", async () => {
    await expect(readNoArticles(SAMPLE_APPROVED.headlines)).resolves.toEqual([
      { storyId: 501, unread: true },
      { storyId: 502, unread: true },
    ]);
  });

  it("makes the image from the title and top stories, renders the email, and names the GHL template by version", async () => {
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
    expect(draft.html).toContain(IMAGE_URL);
    expect(deps.createTemplate).toHaveBeenCalledWith({
      issueDate: "2027-01-04",
      version: 2,
      subject: SAMPLE_CONTENT.title,
      html: draft.html,
    });
  });

  it("stores no preview link when GHL returns none", async () => {
    const { deps } = fakeDeps({ createTemplate: vi.fn(async () => ({ templateId: "dry-run", mode: "recorded" as const })) });
    await expect(produceDraft(INPUT, deps)).resolves.toMatchObject({ ghlPreviewUrl: null, ghlMode: "recorded" });
  });

  const badTitle: WrittenIssueContent = { ...SAMPLE_CONTENT, title: "Too short" };
  const failures: Array<[DraftStep, Partial<ProduceDraftDeps>, Partial<ProduceDraftInput>, string]> = [
    ["read_articles", { readArticles: vi.fn(async () => Promise.reject(new Error("reader down"))) }, {}, "reader down"],
    ["write", { writer: vi.fn(async () => Promise.reject(new Error("The writer refused: no."))) }, {}, "The writer refused: no."],
    ["validate", { writer: vi.fn(async () => structuredClone(badTitle)) }, {}, "The title has 2 words"],
    [
      "image",
      { makeImage: vi.fn(async () => Promise.reject(new FeaturedImageError("upload", new Error("S3 returned HTTP 403.")))) },
      {},
      "Featured image failed at upload: S3 returned HTTP 403.",
    ],
    ["html", {}, { issue: { id: 301, date: "2027-13-40" } }, 'Issue date "2027-13-40" is not a YYYY-MM-DD date.'],
    ["ghl", { createTemplate: vi.fn(async () => Promise.reject(new Error("GHL create template failed with HTTP 401."))) }, {}, "HTTP 401"],
  ];

  it.each(failures)("fails at %s with that step and a plain error, and runs no later step", async (step, overrides, input, message) => {
    const { deps, steps } = fakeDeps(overrides);

    const error = await failure(produceDraft({ ...INPUT, ...input }, deps));

    expect(error.step).toBe(step);
    expect(error.message).toContain(message);
    expect(steps).toEqual(DRAFT_STEPS.slice(0, DRAFT_STEPS.indexOf(step) + 1));
  });

  it("keeps the id of a GHL template that was made before a later GHL call failed", async () => {
    const createTemplate = vi.fn(async () =>
      Promise.reject(new GhlTemplateError("GHL set template HTML failed with HTTP 500.", "setTemplateHtml", 500, "tpl-9")),
    );
    const { deps } = fakeDeps({ createTemplate });

    const error = await failure(produceDraft(INPUT, deps));

    expect(error.step).toBe("ghl");
    expect(error.partial.ghlTemplateId).toBe("tpl-9");
    expect(error.partial.html).toContain('data-draft-id="41"');
  });

  it("keeps the written content when the checks fail, so the owner can see what to fix", async () => {
    const { deps } = fakeDeps({ writer: vi.fn(async () => structuredClone(badTitle)) });

    const error = await failure(produceDraft(INPUT, deps));

    expect(error.partial.content).toEqual(badTitle);
    expect(error.partial.unreadStoryIds).toEqual([501, 502, 503, 504]);
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
    expect(deps.createTemplate).not.toHaveBeenCalled();
  });
});

describe("produceDraft for a new image (#116)", () => {
  const NEW_IMAGE = { imageUrl: "https://assets.example.test/newsletter-dev/2027-01-04-def.jpg", scenePrompt: "A pretend lighthouse." };
  const NEW_IMAGE_INPUT: NewImageDraftInput = {
    issue: { id: 301, date: "2027-01-04" },
    draft: { id: 42, version: 3 },
    source: { content: SAMPLE_CONTENT, unreadStoryIds: [502] },
    image: NEW_IMAGE,
  };

  it("runs only image, html, and GHL: it re-uses the written content and makes no image of its own", async () => {
    const readArticles = vi.fn<ReadArticles>(readNoArticles);
    const checkImage = vi.fn(async (image: { imageUrl: string; scenePrompt: string }) => image);
    const { deps, steps } = fakeDeps({ readArticles, checkImage });

    const draft = await produceDraft(NEW_IMAGE_INPUT, deps);

    expect(NEW_IMAGE_STEPS).toEqual(["image", "html", "ghl"]);
    expect(steps).toEqual(NEW_IMAGE_STEPS);
    expect(readArticles).not.toHaveBeenCalled();
    expect(deps.writer).not.toHaveBeenCalled();
    expect(deps.makeImage).not.toHaveBeenCalled();
    expect(checkImage).toHaveBeenCalledWith(NEW_IMAGE, "2027-01-04");
    expect(draft).toMatchObject({
      content: SAMPLE_CONTENT,
      featuredImageUrl: NEW_IMAGE.imageUrl,
      scenePrompt: NEW_IMAGE.scenePrompt,
      unreadStoryIds: [502],
      ghlTemplateId: "tpl-1",
    });
    expect(Object.keys(draft.stepMs)).toEqual(NEW_IMAGE_STEPS);
  });

  it("renders the same content with the new image, and makes a GHL template for the new version", async () => {
    const { deps } = fakeDeps();

    const draft = await produceDraft(NEW_IMAGE_INPUT, deps);

    const parsed = parseSentEmail(draft.html);
    expect(parsed?.draftId).toBe(42);
    expect(draft.html).toContain(NEW_IMAGE.imageUrl);
    expect(draft.html).not.toContain(IMAGE_URL);
    expect(draft.html).toContain(SAMPLE_CONTENT.headlines[0].headline);
    expect(deps.createTemplate).toHaveBeenCalledWith({ issueDate: "2027-01-04", version: 3, subject: SAMPLE_CONTENT.title, html: draft.html });
  });

  it("does not change the source content it was given", async () => {
    const content = structuredClone(SAMPLE_CONTENT);
    const { deps } = fakeDeps();

    const draft = await produceDraft({ ...NEW_IMAGE_INPUT, source: { content, unreadStoryIds: [] } }, deps);

    expect(content).toEqual(SAMPLE_CONTENT);
    expect(draft.content).toEqual(SAMPLE_CONTENT);
  });

  it("fails at image when the chosen image does not pass its check, and runs no later step", async () => {
    const checkImage = vi.fn(async () => Promise.reject(new Error("The chosen image is not one of ours.")));
    const { deps, steps } = fakeDeps({ checkImage });

    const error = await failure(produceDraft(NEW_IMAGE_INPUT, deps));

    expect(error.step).toBe("image");
    expect(error.message).toBe("The chosen image is not one of ours.");
    expect(error.partial.content).toEqual(SAMPLE_CONTENT);
    expect(steps).toEqual(["image"]);
    expect(deps.createTemplate).not.toHaveBeenCalled();
  });

  it("fails at image, even without a check, when the chosen image is missing", async () => {
    const { deps } = fakeDeps();

    const error = await failure(produceDraft({ ...NEW_IMAGE_INPUT, image: { imageUrl: "", scenePrompt: "" } }, deps));

    expect(error.step).toBe("image");
    expect(error.message).toContain("no chosen image");
  });
});
