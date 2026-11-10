import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});

const ideas = vi.hoisted(() => ({ suggestSceneIdeas: vi.fn() }));
vi.mock("@/src/pipeline/draft/image/scene-ideas", () => ideas);

const images = vi.hoisted(() => ({ makeImageFromScene: vi.fn() }));
vi.mock("@/src/pipeline/draft/image/featured-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/image/featured-image")>()),
  makeImageFromScene: images.makeImageFromScene,
}));

import { createDraft, IssuePublishedError, NewImageError } from "@/src/pipeline/draft/draft-store";
import { SAMPLE_CONTENT, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";
import { FeaturedImageError } from "@/src/pipeline/draft/image/featured-image";
import {
  BOARD_IMAGE_TIMEOUT_MS,
  BOARD_UPLOAD_TIMEOUT_MS,
  chooseNewImage,
  generateImageForDraft,
  MAX_SCENE_PROMPT_CHARS,
  NewImageConfigError,
  newImageErrorResponse,
  NewImageInputError,
  suggestIdeasForDraft,
} from "@/src/pipeline/draft/new-image";
import { readDraftJobRequest } from "@/src/pipeline/draft/start-draft";

const DATE = "2027-01-04";
const NOW = new Date("2027-01-04T15:00:00.000Z");
const SECRET = "s".repeat(32);
const SITE = { siteUrl: "https://deploy-preview-9--ai-recap.netlify.app" };
const ENV = { APP_ENV: "preview", S3_BUCKET: "example-bucket", SESSION_SECRET: SECRET, OPENAI_API_KEY: "test-openai", VERTEX_API_KEY: "test-vertex" };
const OLD_IMAGE = `https://example-bucket.s3.amazonaws.com/newsletter-dev/${DATE}-old111.jpg`;
const NEW_IMAGE = { imageUrl: `https://example-bucket.s3.amazonaws.com/newsletter-dev/${DATE}-new222.jpg`, scenePrompt: "A pretend lighthouse." };

async function readyDraft() {
  const outline = (await fakeDb.client.approvalOutline.create({
    data: { issueDate: new Date(`${DATE}T00:00:00.000Z`), payload: SAMPLE_OUTLINE, payloadHash: "h" },
  })) as { id: bigint };
  const created = await createDraft(outline.id);
  await fakeDb.client.issueDraft.update({
    where: { id: BigInt(created.draftId) },
    data: { status: "ready", content: SAMPLE_CONTENT, html: "<html>v1</html>", featuredImageUrl: OLD_IMAGE, scenePrompt: "A pretend robot." },
  });
  return created;
}

function draftRow(id: number) {
  return fakeDb.state.drafts.rows.find((row) => Number(row.id) === id);
}

beforeEach(() => {
  fakeDb.reset();
  ideas.suggestSceneIdeas.mockReset().mockResolvedValue([{ label: "Lighthouse", scene: "A pretend lighthouse." }]);
  images.makeImageFromScene.mockReset().mockResolvedValue(NEW_IMAGE);
});

describe("suggestIdeasForDraft", () => {
  it("asks for ideas from the ready draft's subject line and top stories", async () => {
    const source = await readyDraft();

    await expect(suggestIdeasForDraft(source.draftId, { env: ENV })).resolves.toEqual([{ label: "Lighthouse", scene: "A pretend lighthouse." }]);

    expect(ideas.suggestSceneIdeas).toHaveBeenCalledWith(
      {
        subjectLine: SAMPLE_CONTENT.title,
        topStories: SAMPLE_CONTENT.headlines.map((story) => ({ headline: story.headline, detail: story.story_detail })),
      },
      { apiKey: "test-openai" },
    );
  });

  it("refuses a draft that is not ready and a published issue, without calling the model", async () => {
    const source = await readyDraft();
    const running = await createDraft(fakeDb.state.outlines.rows[0].id);

    await expect(suggestIdeasForDraft(running.draftId, { env: ENV })).rejects.toBeInstanceOf(NewImageError);
    await fakeDb.client.issue.update({ where: { id: BigInt(source.issueId) }, data: { publishedAt: NOW } });
    await expect(suggestIdeasForDraft(source.draftId, { env: ENV })).rejects.toBeInstanceOf(IssuePublishedError);
    expect(ideas.suggestSceneIdeas).not.toHaveBeenCalled();
  });

  it("reports a model failure as a 502 with the model's message", async () => {
    const source = await readyDraft();
    ideas.suggestSceneIdeas.mockRejectedValue(new Error("Scene ideas failed: Request timed out."));

    const error = await suggestIdeasForDraft(source.draftId, { env: ENV }).catch((reason: unknown) => reason);

    expect(newImageErrorResponse(error)).toEqual({ status: 502, error: "Scene ideas failed: Request timed out." });
  });
});

describe("generateImageForDraft", () => {
  it("makes one image from the owner's scene for the draft's date, with no retries, inside a route's time", async () => {
    const source = await readyDraft();

    await expect(generateImageForDraft(source.draftId, { scenePrompt: "  A pretend lighthouse.  " }, { env: ENV })).resolves.toEqual(NEW_IMAGE);

    expect(images.makeImageFromScene).toHaveBeenCalledWith(
      { scenePrompt: "A pretend lighthouse.", issueDate: DATE },
      {
        appEnv: "preview",
        image: { apiKey: "test-vertex", retries: 0, timeoutMs: BOARD_IMAGE_TIMEOUT_MS },
        upload: { retries: 0, timeoutMs: BOARD_UPLOAD_TIMEOUT_MS },
      },
    );
    // The image and the upload together, with room for the database reads, inside Netlify's 60 s.
    expect(BOARD_IMAGE_TIMEOUT_MS + BOARD_UPLOAD_TIMEOUT_MS).toBeLessThanOrEqual(50_000);
    // Nothing is drafted until the owner picks the image.
    expect(fakeDb.state.drafts.rows).toHaveLength(1);
  });

  it.each([
    ["no body", null],
    ["no scene", {}],
    ["an empty scene", { scenePrompt: "   " }],
    ["a scene that is not text", { scenePrompt: 42 }],
    ["a scene that is too long", { scenePrompt: "x".repeat(MAX_SCENE_PROMPT_CHARS + 1) }],
  ])("refuses %s, and makes no image", async (_name, body) => {
    const source = await readyDraft();

    await expect(generateImageForDraft(source.draftId, body, { env: ENV })).rejects.toBeInstanceOf(NewImageInputError);
    expect(images.makeImageFromScene).not.toHaveBeenCalled();
  });

  it("refuses once the issue is published", async () => {
    const source = await readyDraft();
    await fakeDb.client.issue.update({ where: { id: BigInt(source.issueId) }, data: { publishedAt: NOW } });

    await expect(generateImageForDraft(source.draftId, { scenePrompt: "A lamp." }, { env: ENV })).rejects.toBeInstanceOf(IssuePublishedError);
    expect(images.makeImageFromScene).not.toHaveBeenCalled();
  });
});

describe("chooseNewImage", () => {
  const accepted = () => vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));

  it("makes the next draft with the chosen image and starts its job", async () => {
    const source = await readyDraft();
    const fetch = accepted();

    const result = await chooseNewImage(source.draftId, NEW_IMAGE, SITE, { env: ENV, now: () => NOW, fetch });

    expect(result).toEqual({
      draft: { draftId: expect.any(Number), issueId: source.issueId, version: 2, issueDate: DATE },
      start: { started: true },
    });
    expect(draftRow(result.draft.draftId)).toMatchObject({
      status: "running",
      sourceDraftId: BigInt(source.draftId),
      featuredImageUrl: NEW_IMAGE.imageUrl,
      scenePrompt: NEW_IMAGE.scenePrompt,
    });
    const [url, init] = fetch.mock.calls[0];
    await expect(readDraftJobRequest(new Request(url, init), { SESSION_SECRET: SECRET }, NOW)).resolves.toBe(result.draft.draftId);
  });

  it.each([
    ["an image from elsewhere", { ...NEW_IMAGE, imageUrl: "https://elsewhere.example.test/a.jpg" }, "is not an image this site uploaded"],
    ["an image for another date", { ...NEW_IMAGE, imageUrl: NEW_IMAGE.imageUrl.replace(DATE, "2027-01-05") }, "is not an image this site uploaded"],
    ["no scene prompt", { imageUrl: NEW_IMAGE.imageUrl }, "Send the image and its scene prompt"],
  ])("refuses %s, and makes no draft", async (_name, body, message) => {
    const source = await readyDraft();
    const fetch = accepted();

    const attempt = chooseNewImage(source.draftId, body, SITE, { env: ENV, now: () => NOW, fetch });

    await expect(attempt).rejects.toBeInstanceOf(NewImageInputError);
    await expect(attempt).rejects.toThrow(message);
    expect(fakeDb.state.drafts.rows).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 500 with a plain message when S3_BUCKET is not set, before reading the request, and makes no draft", async () => {
    const source = await readyDraft();
    const fetch = accepted();
    const noBucket = { ...ENV, S3_BUCKET: undefined };

    const error = await chooseNewImage(source.draftId, NEW_IMAGE, SITE, { env: noBucket, now: () => NOW, fetch }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(NewImageConfigError);
    expect(newImageErrorResponse(error)).toEqual({ status: 500, error: "S3_BUCKET is not set on this deploy, so the chosen image cannot be checked." });
    expect(fakeDb.state.drafts.rows).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks the new draft failed at start when its job cannot start, so the board offers Retry", async () => {
    const source = await readyDraft();
    const down = vi.fn<typeof fetch>(async () => new Response(null, { status: 500 }));

    const result = await chooseNewImage(source.draftId, NEW_IMAGE, SITE, { env: ENV, now: () => NOW, fetch: down });

    expect(result.start).toEqual({ started: false, error: "Starting the draft job failed with HTTP 500." });
    expect(draftRow(result.draft.draftId)).toMatchObject({ status: "failed", failedStep: "start", featuredImageUrl: NEW_IMAGE.imageUrl });
  });

  it("refuses once the issue is published, and never changes it", async () => {
    const source = await readyDraft();
    await fakeDb.client.issue.update({ where: { id: BigInt(source.issueId) }, data: { publishedAt: NOW, title: "Sent issue" } });
    const issueBefore = structuredClone(fakeDb.state.issues.rows[0]);

    await expect(chooseNewImage(source.draftId, NEW_IMAGE, SITE, { env: ENV, now: () => NOW, fetch: accepted() })).rejects.toBeInstanceOf(
      IssuePublishedError,
    );
    expect(fakeDb.state.drafts.rows).toHaveLength(1);
    expect(fakeDb.state.issues.rows[0]).toEqual(issueBefore);
  });
});

describe("newImageErrorResponse", () => {
  it("maps each refusal to a status and a plain message, and leaves anything else to the route", () => {
    expect(newImageErrorResponse(new NewImageInputError("Write a scene first."))).toEqual({ status: 400, error: "Write a scene first." });
    expect(newImageErrorResponse(new NewImageError("Draft 9 does not exist.", "missing"))).toEqual({ status: 404, error: "Draft 9 does not exist." });
    expect(newImageErrorResponse(new NewImageError("Draft 9 is running.", "not_ready"))).toMatchObject({ status: 409 });
    expect(newImageErrorResponse(new IssuePublishedError(3, DATE))).toMatchObject({ status: 409, error: expect.stringContaining("already published") });
    expect(newImageErrorResponse(new FeaturedImageError("image", new Error("Vertex returned HTTP 429: Quota")))).toEqual({
      status: 502,
      error: "Featured image failed at image: Vertex returned HTTP 429: Quota",
    });
    expect(newImageErrorResponse(new Error("database down"))).toBeNull();
  });
});
