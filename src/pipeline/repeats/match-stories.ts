import type { JudgePairs, JudgedStory } from "@/src/pipeline/repeats/decisions";
import { EMBEDDING_MODEL, storyText } from "@/src/pipeline/repeats/embed";
import { nearestStories } from "@/src/pipeline/repeats/nearest";
import type { StoryMatchRow } from "@/src/pipeline/repeats/repeat-rules";

/**
 * The repeat check (#90): embed each story once, find its nearest stories of the window, judge each new pair, and
 * store it as a story match. repeat-rules.ts turns the stored matches into repeats and duplicates.
 */

export interface MatchStory {
  id: number;
  /** YYYY-MM-DD. */
  day: string;
  headline: string | null;
  summary: string | null;
}

/** All database access of the check, so the test uses a fake. */
export interface RepeatsStore {
  /** The given stories that have `matched_at` null and a `day`. */
  loadUnmatched(ids: number[]): Promise<MatchStory[]>;
  /** Stories with `day` in [from, to] (YYYY-MM-DD, inclusive). */
  loadStoriesByDay(from: string, to: string): Promise<MatchStory[]>;
  loadEmbeddings(ids: number[]): Promise<{ storyId: number; vector: number[] }[]>;
  saveEmbeddings(rows: { storyId: number; model: string; vector: number[] }[]): Promise<void>;
  /** The pairs stored for any of the given stories, as [newer, older]. */
  loadMatchedPairs(ids: number[]): Promise<[number, number][]>;
  saveMatches(rows: StoryMatchRow[]): Promise<void>;
  markMatched(ids: number[], at: Date): Promise<void>;
}

export interface MatchDeps {
  store: RepeatsStore;
  embed: (texts: string[]) => Promise<number[][]>;
  judge: JudgePairs;
  windowDays: number;
  now?: () => Date;
  /** Called for a story whose judge request failed; it stays unchecked and is tried again. */
  onJudgeError?: (newerId: number, error: unknown) => void;
}

export interface MatchCounts {
  embedded: number;
  judged: number;
  pairs: number;
  refused: number;
}

const MAX_PARALLEL_REQUESTS = 6;
const DAY_MS = 86_400_000;

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
/** The YYYY-MM-DD day `days` days after `day` (before it when negative). */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;

/** "Newer" is the later day; on the same day, the higher id. */
function isNewer(a: MatchStory, b: MatchStory): boolean {
  return a.day === b.day ? a.id > b.id : a.day > b.day;
}

/** A story with a headline and a summary: only those are in the pool. */
function judgedStory(story: MatchStory): JudgedStory {
  return { id: story.id, headline: story.headline!, summary: story.summary! };
}

async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(workers);
}

export async function matchStories(storyIds: number[], deps: MatchDeps): Promise<MatchCounts> {
  const counts: MatchCounts = { embedded: 0, judged: 0, pairs: 0, refused: 0 };
  const now = deps.now ?? (() => new Date());
  const { store, windowDays } = deps;

  const unchecked = storyIds.length > 0 ? await store.loadUnmatched(storyIds) : [];
  if (unchecked.length === 0) return counts;

  // The pool: the window before the earliest unchecked story, up to the latest. The unchecked stories are in it.
  const days = unchecked.map((story) => story.day).sort();
  const pool = (await store.loadStoriesByDay(shiftDay(days[0], -windowDays), days[days.length - 1])).filter(
    (story) => storyText(story) !== null,
  );
  const poolById = new Map(pool.map((story) => [story.id, story]));

  // Embed every pool story that has no embedding yet.
  const vectors = new Map((await store.loadEmbeddings(pool.map((story) => story.id))).map((row) => [row.storyId, row.vector]));
  const notEmbedded = pool.filter((story) => !vectors.has(story.id));
  if (notEmbedded.length > 0) {
    const made = await deps.embed(notEmbedded.map((story) => storyText(story)!));
    const rows = notEmbedded.map((story, index) => ({ storyId: story.id, model: EMBEDDING_MODEL, vector: made[index] }));
    await store.saveEmbeddings(rows);
    for (const row of rows) vectors.set(row.storyId, row.vector);
    counts.embedded = rows.length;
  }

  // The new pairs, grouped by their newer side. A pair already stored, or found twice in this run, is skipped.
  const pairedKeys = new Set((await store.loadMatchedPairs(unchecked.map((story) => story.id))).map(([a, b]) => pairKey(a, b)));
  const oldersByNewer = new Map<number, { older: MatchStory; similarity: number }[]>();
  /** The unchecked stories in each request, so a failed request leaves exactly those unchecked. */
  const uncheckedByNewer = new Map<number, Set<number>>();
  for (const story of unchecked) {
    const vector = vectors.get(story.id);
    if (!vector) continue; // No headline or no summary: no pairs.
    const inWindow = pool.filter((other) => other.id !== story.id && Math.abs(dayNumber(other.day) - dayNumber(story.day)) <= windowDays);
    const nearest = nearestStories(
      vector,
      inWindow.map((other) => ({ id: other.id, vector: vectors.get(other.id)! })),
    );
    for (const { id, similarity } of nearest) {
      const key = pairKey(story.id, id);
      if (pairedKeys.has(key)) continue;
      pairedKeys.add(key);
      const other = poolById.get(id)!;
      const [newer, older] = isNewer(story, other) ? [story, other] : [other, story];
      oldersByNewer.set(newer.id, [...(oldersByNewer.get(newer.id) ?? []), { older, similarity }]);
      uncheckedByNewer.set(newer.id, new Set([...(uncheckedByNewer.get(newer.id) ?? []), story.id]));
    }
  }

  const rows: StoryMatchRow[] = [];
  const failed = new Set<number>();
  await eachLimited([...oldersByNewer.entries()], MAX_PARALLEL_REQUESTS, async ([newerId, olders]) => {
    try {
      const answers = await deps.judge(
        judgedStory(poolById.get(newerId)!),
        olders.map(({ older }) => judgedStory(older)),
      );
      counts.judged += 1;
      counts.refused += olders.length - answers.length;
      const similarityOf = new Map(olders.map(({ older, similarity }) => [older.id, similarity]));
      for (const answer of answers) {
        rows.push({ newerStoryId: newerId, olderStoryId: answer.olderId, similarity: similarityOf.get(answer.olderId)!, same: answer.same, news: answer.news });
      }
    } catch (error) {
      for (const id of uncheckedByNewer.get(newerId)!) failed.add(id);
      deps.onJudgeError?.(newerId, error);
    }
  });

  if (rows.length > 0) await store.saveMatches(rows);
  counts.pairs = rows.length;
  const checked = unchecked.map((story) => story.id).filter((id) => !failed.has(id));
  if (checked.length > 0) await store.markMatched(checked, now());
  return counts;
}
