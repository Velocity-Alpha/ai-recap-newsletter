import { describe, expect, it, vi } from "vitest";
import { embedTexts, storyText, type EmbeddingsClient } from "@/src/pipeline/repeats/embed";

function fakeClient() {
  const create = vi.fn(async (request: { input: string[] }) => ({
    // Returned out of order, so the code must sort by index.
    data: request.input.map((text, index) => ({ index, embedding: [text.length, index] })).reverse(),
  }));
  return { client: { embeddings: { create } } as unknown as EmbeddingsClient, create };
}

describe("storyText", () => {
  it("is the headline and the summary on two lines", () => {
    expect(storyText({ headline: "Headline", summary: "Summary." })).toBe("Headline\nSummary.");
  });

  it("is null without a headline or a summary", () => {
    expect(storyText({ headline: "Headline", summary: null })).toBeNull();
    expect(storyText({ headline: " ", summary: "Summary." })).toBeNull();
  });
});

describe("embedTexts", () => {
  it("sends the model, 512 dimensions and floats, and returns the vectors in input order", async () => {
    const { client, create } = fakeClient();
    await expect(embedTexts(["a", "bb"], { client })).resolves.toEqual([
      [1, 0],
      [2, 1],
    ]);
    expect(create).toHaveBeenCalledWith({ model: "text-embedding-3-small", input: ["a", "bb"], dimensions: 512, encoding_format: "float" });
  });

  it("sends at most 500 texts in one request", async () => {
    const { client, create } = fakeClient();
    const texts = Array.from({ length: 1001 }, (_, index) => `t${index}`);
    const vectors = await embedTexts(texts, { client });
    expect(create.mock.calls.map(([request]) => request.input.length)).toEqual([500, 500, 1]);
    expect(vectors).toHaveLength(1001);
    expect(vectors[1000]).toEqual(["t1000".length, 0]);
  });

  it("sends nothing for no texts", async () => {
    const { client, create } = fakeClient();
    await expect(embedTexts([], { client })).resolves.toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});
