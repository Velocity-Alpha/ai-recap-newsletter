/** Pure helpers of the section scoring test (#176): streams, automatic fill in fill order, and AUC. */

export interface FillSection {
  key: string;
  /** How many stories automatic fill pre-selects. Not a maximum. */
  fillCount: number;
}

/** The score of a story for a section. 0 means the story is not in that section's stream. */
export type Scorer<S> = (story: S, section: string) => number;

/** A section's stream: every story that scores above 0, best first. Equal scores: the lower id first. */
export function stream<S extends { id: number }>(stories: readonly S[], section: string, scorer: Scorer<S>): S[] {
  return stories
    .map((story) => ({ story, score: scorer(story, section) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.story.id - b.story.id)
    .map((entry) => entry.story);
}

/**
 * Automatic fill: go through the sections in the given (fill) order. Each section takes the best stories of its
 * stream that no earlier section took, up to its fill count.
 */
export function fill<S extends { id: number }>(
  stories: readonly S[],
  sections: readonly FillSection[],
  scorer: Scorer<S>,
): Record<string, S[]> {
  const taken = new Set<number>();
  const result: Record<string, S[]> = {};
  for (const section of sections) {
    const selected = stream(
      stories.filter((story) => !taken.has(story.id)),
      section.key,
      scorer,
    ).slice(0, section.fillCount);
    selected.forEach((story) => taken.add(story.id));
    result[section.key] = selected;
  }
  return result;
}

/** The place of a story in a section's stream, from 1. Null when the story is not in the stream. */
export function rankOf<S extends { id: number }>(
  stories: readonly S[],
  section: string,
  scorer: Scorer<S>,
  id: number,
): number | null {
  const index = stream(stories, section, scorer).findIndex((story) => story.id === id);
  return index === -1 ? null : index + 1;
}

/**
 * Groups stories that report the same event. Two stories are in one group when they are similar, directly or
 * through other stories. Returns story id → group id, where the group id is the lowest story id in the group.
 */
export function groupEvents(ids: readonly number[], similar: (a: number, b: number) => boolean): Map<number, number> {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!similar(ids[i], ids[j])) continue;
      const a = find(ids[i]);
      const b = find(ids[j]);
      if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
    }
  }
  return new Map(ids.map((id) => [id, find(id)]));
}

/** The chance that a random positive scores above a random negative. A tie counts as half. */
export function auc(positives: readonly number[], negatives: readonly number[]): number {
  if (positives.length === 0 || negatives.length === 0) return NaN;
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}
