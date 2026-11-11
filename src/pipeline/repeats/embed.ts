import OpenAI from "openai";

/** One embedding for each story, made once (#90). The test set in `__fixtures__/` was built with these values. */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 512;
const MAX_TEXTS_PER_REQUEST = 500;

/** The part of the OpenAI client this needs, so tests can pass a fake. */
export interface EmbeddingsClient {
  embeddings: { create(request: never): Promise<{ data: { index: number; embedding: number[] }[] }> };
}

export function createEmbeddingsClient(options: { apiKey: string }): EmbeddingsClient {
  return new OpenAI({ apiKey: options.apiKey, timeout: 60_000, maxRetries: 2 }) as unknown as EmbeddingsClient;
}

/** The text that is embedded for a story, or null when it has no headline or no summary (then it gets no pairs). */
export function storyText(story: { headline: string | null; summary: string | null }): string | null {
  if (!story.headline?.trim() || !story.summary?.trim()) return null;
  return `${story.headline}\n${story.summary}`;
}

/** The vectors come back with length 1, so cosine similarity is their dot product. */
export async function embedTexts(texts: string[], deps: { client: EmbeddingsClient }): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += MAX_TEXTS_PER_REQUEST) {
    const input = texts.slice(start, start + MAX_TEXTS_PER_REQUEST);
    const request = { model: EMBEDDING_MODEL, input, dimensions: EMBEDDING_DIMENSIONS, encoding_format: "float" };
    const response = await deps.client.embeddings.create(request as never);
    const data = [...response.data].sort((a, b) => a.index - b.index);
    if (data.length !== input.length) throw new Error(`Embeddings: sent ${input.length} texts, got ${data.length} vectors.`);
    vectors.push(...data.map((item) => item.embedding));
  }
  return vectors;
}
