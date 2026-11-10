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

import { DraftTitleError } from "@/src/pipeline/draft/draft-edit";
import { createDraft, DraftEditError, IssuePublishedError } from "@/src/pipeline/draft/draft-store";
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
  NewImageServiceError,
  suggestIdeasForDraft,
} from "@/src/pipeline/draft/new-image";

const DATE = "2027-01-04";
const NOW = new Date("2027-01-04T15:00:00.000Z");
const ENV = { APP_ENV: "preview", S3_BUCKET: "example-bucket", OPENAI_API_KEY: "test-openai", VERTEX_API_KEY: "test-vertex" };
const OLD_IMAGE = `https://example-bucket.s3.amazonaws.com/newsletter-dev/${DATE}-old111.jpg`;
const OLD_HTML = "<html>v1</html>";
const NEW_IMAGE = { imageUrl: `https://example-bucket.s3.amazonaws.com/newsletter-dev/${DATE}-new222.jpg`, scenePrompt: "A pretend lighthouse." };

async function readyDraft() {
  const outline = (await fakeDb.client.approvalOutline.create({
    data: { issueDate: new Date(`${DATE}T00:00:00.000Z`), payload: SAMPLE_OUTLINE, payloadHash: "h" },
  })) as { id: bigint };
  const created = await createDraft(outline.id);
  await fakeDb.client.issueDraft.update({
    where: { id: BigInt(created.draftId) },
    data: { status: "ready", content: SAMPLE_CONTENT, html: OLD_HTML, featuredImageUrl: OLD_IMAGE, scenePrompt: "A pretend robot." },
  });
  return created;
}

function draftRow(id: number) {
  return fakeDb.state.drafts.rows.find((row) => Number(row.id) === id)!;
}

function issueRow(id: number) {
  return fakeDb.state.issues.rows.find((row) => Number(row.id) === id)!;
}

beforeEach(() => {
  fakeDb.reset();
  ideas.suggestSceneIdeas.mockReset().mockResolvedValue([{ label: "Lighthouse", scene: "A pretend lighthouse." }]);
  images.makeImageFromScene.mockReset().mockResolvedValue(NEW_IMAGE);
});

describe("suggestIdeasForDraft", () => {
  it("asks for ideas from the current draft's subject line and top stories", async () => {
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

  it("refuses a draft that is not ready, an older draft, and a published issue, without calling the model", async () => {
    const source = await readyDraft();
    const running = await createDraft(fakeDb.state.outlines.rows[0].id);

    await expect(suggestIdeasForDraft(running.draftId, { env: ENV })).rejects.toMatchObject({ name: "DraftEditError", reason: "not_ready" });
    await expect(suggestIdeasForDraft(source.draftId, { env: ENV })).rejects.toMatchObject({ name: "DraftEditError", reason: "not_current" });
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
    const before = structuredClone(draftRow(source.draftId));

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
    // The draft does not change until the owner picks the image.
    expect(fakeDb.state.drafts.rows).toHaveLength(1);
    expect(draftRow(source.draftId)).toEqual(before);
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

  it("refuses an older draft once a newer one exists, and makes no image", async () => {
    const source = await readyDraft();
    await createDraft(fakeDb.state.outlines.rows[0].id);

    await expect(generateImageForDraft(source.draftId, { scenePrompt: "A lamp." }, { env: ENV })).rejects.toMatchObject({
      name: "DraftEditError",
      reason: "not_current",
    });
    expect(images.makeImageFromScene).not.toHaveBeenCalled();
  });
});

describe("chooseNewImage", () => {
  /** S3's answer to the HEAD request for an uploaded JPEG. */
  const inS3 = () => vi.fn<typeof fetch>(async () => new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } }));

  it("checks the image is in S3, then puts it into the same draft and the issue", async () => {
    const source = await readyDraft();
    const fetch = inS3();

    const result = await chooseNewImage(source.draftId, NEW_IMAGE, { env: ENV, now: () => NOW, fetch });

    expect(result).toEqual({
      draftId: source.draftId,
      issueId: source.issueId,
      version: 1,
      issueDate: DATE,
      content: SAMPLE_CONTENT,
      featuredImageUrl: NEW_IMAGE.imageUrl,
      scenePrompt: NEW_IMAGE.scenePrompt,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(NEW_IMAGE.imageUrl, expect.objectContaining({ method: "HEAD" }));
    const row = draftRow(source.draftId);
    expect(row).toMatchObject({
      version: 1,
      status: "ready",
      content: SAMPLE_CONTENT,
      featuredImageUrl: NEW_IMAGE.imageUrl,
      scenePrompt: NEW_IMAGE.scenePrompt,
      editedAt: NOW,
    });
    expect(row.html).not.toBe(OLD_HTML);
    expect(row.html).toContain(`url=${NEW_IMAGE.imageUrl}"`);
    expect(row.html).toContain(SAMPLE_CONTENT.title);
    expect(issueRow(source.issueId)).toMatchObject({
      title: SAMPLE_CONTENT.title,
      html: row.html,
      featureImageUrl: NEW_IMAGE.imageUrl,
      promptFeaturedImage: NEW_IMAGE.scenePrompt,
    });
  });

  it("makes no new draft and no staged version, and starts no job", async () => {
    const source = await readyDraft();
    const fetch = inS3();

    await chooseNewImage(source.draftId, NEW_IMAGE, { env: ENV, now: () => NOW, fetch });

    expect(fakeDb.state.drafts.rows).toHaveLength(1);
    expect(fakeDb.state.stagedVersions.rows).toHaveLength(0);
    // The only request is the HEAD to S3: nothing goes to the draft job or the distribution service.
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([[NEW_IMAGE.imageUrl, "HEAD"]]);
  });

  it("trims the image address and the scene prompt", async () => {
    const source = await readyDraft();

    const result = await chooseNewImage(
      source.draftId,
      { imageUrl: `  ${NEW_IMAGE.imageUrl}  `, scenePrompt: `  ${NEW_IMAGE.scenePrompt}\n` },
      { env: ENV, now: () => NOW, fetch: inS3() },
    );

    expect(result).toMatchObject({ featuredImageUrl: NEW_IMAGE.imageUrl, scenePrompt: NEW_IMAGE.scenePrompt });
  });

  it.each([
    ["an image from elsewhere", { ...NEW_IMAGE, imageUrl: "https://elsewhere.example.test/a.jpg" }, "is not an image this site uploaded"],
    ["an image for another date", { ...NEW_IMAGE, imageUrl: NEW_IMAGE.imageUrl.replace(DATE, "2027-01-05") }, "is not an image this site uploaded"],
    ["no scene prompt", { imageUrl: NEW_IMAGE.imageUrl }, "Send the image and its scene prompt"],
    ["no image", { scenePrompt: NEW_IMAGE.scenePrompt }, "Send the image and its scene prompt"],
    ["no body", null, "Send the image and its scene prompt"],
    ["an empty scene prompt", { ...NEW_IMAGE, scenePrompt: "   " }, "Write a scene prompt first."],
    ["a scene prompt that is too long", { ...NEW_IMAGE, scenePrompt: "x".repeat(MAX_SCENE_PROMPT_CHARS + 1) }, "Keep it under"],
  ])("refuses %s as a bad request, without asking S3, and leaves the draft as it was", async (_name, body, message) => {
    const source = await readyDraft();
    const before = structuredClone(draftRow(source.draftId));
    const fetch = inS3();

    const error = await chooseNewImage(source.draftId, body, { env: ENV, now: () => NOW, fetch }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(NewImageInputError);
    expect((error as Error).message).toContain(message);
    expect(newImageErrorResponse(error)).toMatchObject({ status: 400 });
    expect(draftRow(source.draftId)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["is missing from S3", () => new Response(null, { status: 404 }), "The chosen image is not in S3 as a JPEG (HTTP 404)."],
    [
      "is not a JPEG",
      () => new Response(null, { status: 200, headers: { "content-type": "text/html" } }),
      "The chosen image is not in S3 as a JPEG (HTTP 200, text/html).",
    ],
  ])("answers 502 when the image %s, and leaves the draft and the issue as they were", async (_name, answer, message) => {
    const source = await readyDraft();
    const before = structuredClone({ draft: draftRow(source.draftId), issue: issueRow(source.issueId) });
    const s3 = vi.fn<typeof fetch>(async () => answer());

    const error = await chooseNewImage(source.draftId, NEW_IMAGE, { env: ENV, now: () => NOW, fetch: s3 }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(NewImageServiceError);
    expect(newImageErrorResponse(error)).toEqual({ status: 502, error: message });
    expect(draftRow(source.draftId)).toEqual(before.draft);
    expect(issueRow(source.issueId)).toEqual(before.issue);
  });

  it("answers 502 when S3 cannot be reached, and leaves the draft as it was", async () => {
    const source = await readyDraft();
    const before = structuredClone(draftRow(source.draftId));
    const s3 = vi.fn<typeof fetch>(async () => {
      throw new Error("network down");
    });

    const error = await chooseNewImage(source.draftId, NEW_IMAGE, { env: ENV, now: () => NOW, fetch: s3 }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(NewImageServiceError);
    expect(newImageErrorResponse(error)).toEqual({ status: 502, error: "Could not check the chosen image in S3: network down" });
    expect(draftRow(source.draftId)).toEqual(before);
  });

  it("answers 500 with a plain message when S3_BUCKET is not set, before reading the request, and changes nothing", async () => {
    const source = await readyDraft();
    const before = structuredClone(draftRow(source.draftId));
    const fetch = inS3();
    const noBucket = { ...ENV, S3_BUCKET: undefined };

    const error = await chooseNewImage(source.draftId, null, { env: noBucket, now: () => NOW, fetch }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(NewImageConfigError);
    expect(newImageErrorResponse(error)).toEqual({ status: 500, error: "S3_BUCKET is not set on this deploy, so the chosen image cannot be checked." });
    expect(draftRow(source.draftId)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses once the issue is published, without asking S3, and never changes it", async () => {
    const source = await readyDraft();
    await fakeDb.client.issue.update({ where: { id: BigInt(source.issueId) }, data: { publishedAt: NOW, title: "Sent issue" } });
    const before = structuredClone({ draft: draftRow(source.draftId), issue: issueRow(source.issueId) });
    const fetch = inS3();

    await expect(chooseNewImage(source.draftId, NEW_IMAGE, { env: ENV, now: () => NOW, fetch })).rejects.toBeInstanceOf(IssuePublishedError);

    expect(fakeDb.state.drafts.rows).toHaveLength(1);
    expect(draftRow(source.draftId)).toEqual(before.draft);
    expect(issueRow(source.issueId)).toEqual(before.issue);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an older draft once a newer one exists, a draft that is not ready, and a missing draft, without asking S3", async () => {
    const source = await readyDraft();
    const running = await createDraft(fakeDb.state.outlines.rows[0].id);
    const before = structuredClone(fakeDb.state.drafts.rows);
    const fetch = inS3();
    const options = { env: ENV, now: () => NOW, fetch };

    await expect(chooseNewImage(source.draftId, NEW_IMAGE, options)).rejects.toMatchObject({ name: "DraftEditError", reason: "not_current" });
    await expect(chooseNewImage(running.draftId, NEW_IMAGE, options)).rejects.toMatchObject({ name: "DraftEditError", reason: "not_ready" });
    await expect(chooseNewImage(999, NEW_IMAGE, options)).rejects.toMatchObject({ name: "DraftEditError", reason: "missing" });

    expect(fakeDb.state.drafts.rows).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("newImageErrorResponse", () => {
  it("maps each refusal to a status and a plain message, and leaves anything else to the route", () => {
    expect(newImageErrorResponse(new NewImageInputError("Write a scene first."))).toEqual({ status: 400, error: "Write a scene first." });
    expect(newImageErrorResponse(new NewImageConfigError("S3_BUCKET is not set."))).toEqual({ status: 500, error: "S3_BUCKET is not set." });
    expect(newImageErrorResponse(new DraftEditError("Draft 9 does not exist.", "missing"))).toEqual({ status: 404, error: "Draft 9 does not exist." });
    expect(newImageErrorResponse(new DraftEditError("The draft is running.", "not_ready"))).toEqual({ status: 409, error: "The draft is running." });
    expect(newImageErrorResponse(new DraftEditError("This is not the newest draft.", "not_current"))).toMatchObject({ status: 409 });
    expect(newImageErrorResponse(new IssuePublishedError(3, DATE))).toMatchObject({ status: 409, error: expect.stringContaining("already published") });
    expect(newImageErrorResponse(new FeaturedImageError("image", new Error("Vertex returned HTTP 429: Quota")))).toEqual({
      status: 502,
      error: "Featured image failed at image: Vertex returned HTTP 429: Quota",
    });
    expect(newImageErrorResponse(new NewImageServiceError("The chosen image is not in S3 as a JPEG (HTTP 404)."))).toEqual({
      status: 502,
      error: "The chosen image is not in S3 as a JPEG (HTTP 404).",
    });
    expect(newImageErrorResponse(new Error("database down"))).toBeNull();
  });

  it("answers as the draft edit does for anything that module knows", () => {
    expect(newImageErrorResponse(new DraftTitleError("The title is empty. Write a title first."))).toEqual({
      status: 400,
      error: "The title is empty. Write a title first.",
    });
  });
});
