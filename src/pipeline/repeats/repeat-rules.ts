/**
 * The repeat check (#90): the levels of a judged pair, and the board rules that turn stored pairs into repeats
 * removed, duplicates grouped, and labels. Pure: no database. The thresholds were measured on the test set in
 * `__fixtures__/` (read its README.md). Do not change them without running the fixture tests.
 */

export const NEAREST_COUNT = 5;
export const MIN_SIMILARITY = 0.55;
export const SURE_SAME = 0.85; // same >= SURE_SAME
export const SURE_MAX_NEWS = 0.5; // and news <= SURE_MAX_NEWS  => "sure"
export const SIMILAR_SAME = 0.5; // same >= SIMILAR_SAME and not sure => "similar"
export const DEFAULT_WINDOW_DAYS = 14;
/** The pipeline setting that holds the window in days. */
export const WINDOW_SETTING = "repeats.window_days";
const MAX_LABELS = 3;

export type PairLevel = "sure" | "similar";

/** One story match: two stories, how alike their embeddings are, and the two answers of the judge. */
export interface StoryMatchRow {
  newerStoryId: number;
  olderStoryId: number;
  similarity: number;
  same: number;
  news: number;
}

export type ReferenceKind = "published" | "held";

/** A story of an earlier issue (`published`) or of an unsent draft (`held`). `date` is the issue date. */
export interface RepeatReference {
  headline: string;
  date: string;
  kind: ReferenceKind;
}

export interface ExcludedStory {
  headline: string;
  excludedOn: string | null;
}

export interface SimilarStory {
  kind: ReferenceKind | "excluded";
  id: number;
  headline: string;
  date: string | null;
}

export function pairLevel(match: { same: number; news: number }): PairLevel | null {
  if (match.same >= SURE_SAME && match.news <= SURE_MAX_NEWS) return "sure";
  if (match.same >= SIMILAR_SAME) return "similar";
  return null;
}

/** The value of the `repeats.window_days` setting, or the default when it is missing or not a positive number. */
export function windowDaysFromSetting(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_WINDOW_DAYS;
}

interface Pair {
  other: number;
  same: number;
  level: PairLevel | null;
}

function pairsByStory(matches: StoryMatchRow[]): Map<number, Pair[]> {
  const byStory = new Map<number, Pair[]>();
  const add = (story: number, pair: Pair) => {
    const list = byStory.get(story);
    if (list) list.push(pair);
    else byStory.set(story, [pair]);
  };
  for (const match of matches) {
    const level = pairLevel(match);
    add(match.newerStoryId, { other: match.olderStoryId, same: match.same, level });
    add(match.olderStoryId, { other: match.newerStoryId, same: match.same, level });
  }
  return byStory;
}

export function applyRepeatRules<T extends { id: number }>(input: {
  /** Ranked: the order is the rank. */
  candidates: T[];
  /** Every stored pair that touches a candidate, or touches a story paired with a candidate. */
  matches: StoryMatchRow[];
  references: Map<number, RepeatReference>;
  excluded: Map<number, ExcludedStory>;
}): {
  heads: T[];
  removed: { story: T; repeatOf: { id: number } & RepeatReference }[];
  merged: { story: T; into: number }[];
  similarTo: Map<number, SimilarStory[]>;
} {
  const { candidates, references, excluded } = input;
  const pairs = pairsByStory(input.matches);
  const pairsOf = (id: number) => pairs.get(id) ?? [];

  /** The reference a story is a sure pair to, with the highest `same`. Only a direct pair counts. */
  function sureReference(id: number): { id: number; same: number } | null {
    let best: { id: number; same: number } | null = null;
    for (const pair of pairsOf(id)) {
      if (pair.level !== "sure" || !references.has(pair.other)) continue;
      if (!best || pair.same > best.same) best = { id: pair.other, same: pair.same };
    }
    return best;
  }

  // 1. Remove repeats.
  const removed: { story: T; repeatOf: { id: number } & RepeatReference }[] = [];
  const remaining: T[] = [];
  for (const candidate of candidates) {
    const reference = sureReference(candidate.id);
    if (reference) removed.push({ story: candidate, repeatOf: { id: reference.id, ...references.get(reference.id)! } });
    else remaining.push(candidate);
  }

  // 2. Group duplicates: merge into the first head with a sure pair. Only heads take members, never members.
  const heads: T[] = [];
  const members = new Map<number, T[]>();
  const merged: { story: T; into: number }[] = [];
  for (const candidate of remaining) {
    const surePartners = new Set(pairsOf(candidate.id).filter((pair) => pair.level === "sure").map((pair) => pair.other));
    const head = heads.find((existing) => surePartners.has(existing.id));
    if (head) {
      merged.push({ story: candidate, into: head.id });
      members.get(head.id)!.push(candidate);
    } else {
      heads.push(candidate);
      members.set(candidate.id, [candidate]);
    }
  }

  // 3. Label each head from itself and the stories merged into it.
  const similarTo = new Map<number, SimilarStory[]>();
  for (const head of heads) {
    const found = new Map<number, { entry: SimilarStory; same: number }>();
    const note = (entry: SimilarStory, same: number) => {
      const existing = found.get(entry.id);
      if (!existing || same > existing.same) found.set(entry.id, { entry, same });
    };
    for (const member of members.get(head.id)!) {
      for (const pair of pairsOf(member.id)) {
        const reference = references.get(pair.other);
        if (reference && pair.level !== null) {
          note({ kind: reference.kind, id: pair.other, headline: reference.headline, date: reference.date }, pair.same);
        }
        const excludedStory = excluded.get(pair.other);
        if (excludedStory && pair.level !== null) {
          note({ kind: "excluded", id: pair.other, headline: excludedStory.headline, date: excludedStory.excludedOn }, pair.same);
        }
        // A chain: the member looks like X, and X is a sure repeat of a reference.
        if (pair.same >= SIMILAR_SAME && !reference) {
          const chained = sureReference(pair.other);
          if (chained && chained.id !== member.id) {
            const chainedReference = references.get(chained.id)!;
            note({ kind: chainedReference.kind, id: chained.id, headline: chainedReference.headline, date: chainedReference.date }, pair.same);
          }
        }
      }
    }
    if (found.size === 0) continue;
    const order = (entry: SimilarStory) => (entry.kind === "excluded" ? 1 : 0);
    const labels = [...found.values()]
      .sort((a, b) => order(a.entry) - order(b.entry) || b.same - a.same)
      .slice(0, MAX_LABELS)
      .map(({ entry }) => entry);
    similarTo.set(head.id, labels);
  }

  return { heads, removed, merged, similarTo };
}
