import { MIN_SIMILARITY, NEAREST_COUNT } from "@/src/pipeline/repeats/repeat-rules";

/**
 * The nearest stories to one embedding. The embeddings have length 1, so cosine similarity is the dot product.
 * Arithmetic in the app: about 600 stories are in the window, so no vector index is needed.
 */
export function nearestStories(
  target: number[],
  pool: { id: number; vector: number[] }[],
  options: { count: number; minSimilarity: number } = { count: NEAREST_COUNT, minSimilarity: MIN_SIMILARITY },
): { id: number; similarity: number }[] {
  const scored: { id: number; similarity: number }[] = [];
  for (const story of pool) {
    let similarity = 0;
    for (let i = 0; i < target.length; i++) similarity += target[i] * story.vector[i];
    if (similarity >= options.minSimilarity) scored.push({ id: story.id, similarity });
  }
  return scored.sort((a, b) => b.similarity - a.similarity || a.id - b.id).slice(0, options.count);
}
