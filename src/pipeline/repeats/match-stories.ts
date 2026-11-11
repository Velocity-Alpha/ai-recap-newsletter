import type { JudgePairs } from "@/src/pipeline/repeats/decisions";
import { EMBEDDING_MODEL, storyText } from "@/src/pipeline/repeats/embed";
import { nearestStories } from "@/src/pipeline/repeats/nearest";
import type { StoryMatchRow } from "@/src/pipeline/repeats/repeat-rules";

/**
 * The repeat check at ingestion (#90): embed each story once, find its nearest stories of the window, judge each new
 * pair, and store it as a story match. The board turns the stored matches into repeats and duplicates
 * (repeat-rules.ts).
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
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;

/** "Newer" is the later day; on the same day, the higher id. */
function isNewer(a: MatchStory, b: MatchStory): boolean {
  return a.day === b.day ? a.id > b.id : a.day > b.day;
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

  const given = storyIds.length > 0 ? await store.loadUnmatched(storyIds) : [];
  if (given.length === 0) return counts;

  // The pool: the window before the earliest given story, up to the latest. The given stories are in it.
  const days = given.map((story) => story.day).sort();
  const pool = (await store.loadStoriesByDay(shiftDay(days[0], -windowDays), days[days.length - 1])).filter(
    (story) => storyText(story) !== null,
  );
  const byId = new Map(pool.map((story) => [story.id, story]));

  // Embed every pool story that has no embedding yet.
  const vectors = new Map((await store.loadEmbeddings(pool.map((story) => story.id))).map((row) => [row.storyId, row.vector]));
  const missing = pool.filter((story) => !vectors.has(story.id));
  if (missing.length > 0) {
    const made = await deps.embed(missing.map((story) => storyText(story)!));
    const rows = missing.map((story, index) => ({ storyId: story.id, model: EMBEDDING_MODEL, vector: made[index] }));
    await store.saveEmbeddings(rows);
    for (const row of rows) vectors.set(row.storyId, row.vector);
    counts.embedded = rows.length;
  }

  // The new pairs of each given story, grouped by their newer side.
  const known = new Set((await store.loadMatchedPairs(given.map((story) => story.id))).map(([a, b]) => pairKey(a, b)));
  const byNewer = new Map<number, { older: MatchStory; similarity: number }[]>();
  /** The given stories each pair touches, so a failed request leaves exactly those unchecked. */
  const givenByNewer = new Map<number, Set<number>>();
  for (const story of given) {
    const vector = vectors.get(story.id);
    if (!vector) continue; // No headline or no summary: no pairs.
    const near = pool.filter((other) => other.id !== story.id && Math.abs(dayNumber(other.day) - dayNumber(story.day)) <= windowDays);
    const nearest = nearestStories(
      vector,
      near.map((other) => ({ id: other.id, vector: vectors.get(other.id)! })),
    );
    for (const { id, similarity } of nearest) {
      const key = pairKey(story.id, id);
      if (known.has(key)) continue;
      known.add(key);
      const other = byId.get(id)!;
      const [newer, older] = isNewer(story, other) ? [story, other] : [other, story];
      const list = byNewer.get(newer.id) ?? [];
      list.push({ older, similarity });
      byNewer.set(newer.id, list);
      const touched = givenByNewer.get(newer.id) ?? new Set<number>();
      touched.add(story.id);
      givenByNewer.set(newer.id, touched);
    }
  }

  const rows: StoryMatchRow[] = [];
  const failed = new Set<number>();
  await eachLimited([...byNewer.entries()], MAX_PARALLEL_REQUESTS, async ([newerId, olders]) => {
    const newer = byId.get(newerId)!;
    try {
      const answers = await deps.judge(
        { id: newer.id, headline: newer.headline!, summary: newer.summary! },
        olders.map(({ older }) => ({ id: older.id, headline: older.headline!, summary: older.summary! })),
      );
      counts.judged += 1;
      counts.refused += olders.length - answers.length;
      const similarityOf = new Map(olders.map(({ older, similarity }) => [older.id, similarity]));
      for (const answer of answers) {
        rows.push({ newerStoryId: newerId, olderStoryId: answer.olderId, similarity: similarityOf.get(answer.olderId)!, same: answer.same, news: answer.news });
      }
    } catch (error) {
      for (const id of givenByNewer.get(newerId)!) failed.add(id);
      deps.onJudgeError?.(newerId, error);
    }
  });

  if (rows.length > 0) await store.saveMatches(rows);
  counts.pairs = rows.length;
  const checked = given.map((story) => story.id).filter((id) => !failed.has(id));
  if (checked.length > 0) await store.markMatched(checked, now());
  return counts;
}
