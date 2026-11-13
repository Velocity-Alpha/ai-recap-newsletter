/** The p-th percentile (0 to 100) by nearest rank, or null for no values. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** A count of one item (all its repeats) for one config. */
export interface ItemCount {
  hits: number;
  n: number;
}

/** A difference in share (other minus baseline, -1 to 1) with its 95% interval. */
export interface PairedDiff {
  diff: number;
  low: number;
  high: number;
}

export const BOOTSTRAP_RESAMPLES = 2000;
const BOOTSTRAP_SEED = 20261111;

/** mulberry32: a small seeded random number generator, so a bootstrap gives the same interval every time. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shareDiff(pairs: Array<{ baseline: ItemCount; other: ItemCount }>): number | null {
  let baseHits = 0, baseN = 0, otherHits = 0, otherN = 0;
  for (const { baseline, other } of pairs) {
    baseHits += baseline.hits;
    baseN += baseline.n;
    otherHits += other.hits;
    otherN += other.n;
  }
  return baseN === 0 || otherN === 0 ? null : otherHits / otherN - baseHits / baseN;
}

/**
 * The difference in share between two configs run on the same items, with a 95% paired bootstrap interval:
 * each resample draws items with replacement, and an item brings its counts of both configs (all its repeats).
 * Fixed seed, BOOTSTRAP_RESAMPLES resamples. Null when either config counted nothing.
 */
export function pairedBootstrap(pairs: Array<{ baseline: ItemCount; other: ItemCount }>): PairedDiff | null {
  const diff = shareDiff(pairs);
  if (diff === null) return null;
  const random = seededRandom(BOOTSTRAP_SEED);
  const diffs: number[] = [];
  for (let resample = 0; resample < BOOTSTRAP_RESAMPLES; resample++) {
    const drawn = pairs.map(() => pairs[Math.floor(random() * pairs.length)]);
    const one = shareDiff(drawn);
    if (one !== null) diffs.push(one);
  }
  return { diff, low: percentile(diffs, 2.5) ?? diff, high: percentile(diffs, 97.5) ?? diff };
}

/** The mean, or 0 for no values. */
export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
