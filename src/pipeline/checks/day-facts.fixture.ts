import type { DayFacts } from "@/src/pipeline/checks/day-facts";

/** Synthetic days for the check tests. No real story or issue text. */

const NORMAL_SOURCES = {
  rundown_ai: 14,
  ai_breakfast: 12,
  the_signal: 10,
  tldr: 16,
  alphasignal: 9,
  product_hunt_ai: 10,
  huggingface: 10,
};

function total(bySource: Record<string, number>): number {
  return Object.values(bySource).reduce((sum, count) => sum + count, 0);
}

/** Tuesday 2026-11-10: 81 stories from every source, committed at 11:42, published at 12:31 New York. */
export function normalDay(overrides: Partial<DayFacts> = {}): DayFacts {
  const storiesBySource = overrides.storiesBySource ?? NORMAL_SOURCES;
  return {
    date: "2026-11-10",
    weekday: "Tue",
    skipped: null,
    ingestOwner: "native",
    ingestRun: { id: "41", status: "succeeded", startedAt: new Date("2026-11-10T14:55:00Z") },
    weekdayTotals: [78, 85, 80, 90, 76, 82, 88, 79], // median 81
    queuedStories: 23,
    committed: true,
    commitTime: new Date("2026-11-10T16:42:00Z"),
    draftsMade: 1,
    draftReady: true,
    issue: {
      id: "270",
      slug: "synthetic-model-ships",
      title: "Synthetic Model Ships & Agents Learn",
      publishedAt: new Date("2026-11-10T17:31:00Z"),
    },
    warnings: [],
    ...overrides,
    storiesBySource,
    storyTotal: overrides.storyTotal ?? total(storiesBySource),
  };
}

/** Monday 2026-11-09: 35 stories. Thin for a Tuesday (median 81), normal for a Monday (median 43). */
export function monday(overrides: Partial<DayFacts> = {}): DayFacts {
  return normalDay({
    date: "2026-11-09",
    weekday: "Mon",
    ingestRun: { id: "40", status: "succeeded", startedAt: new Date("2026-11-09T14:55:00Z") },
    storiesBySource: { rundown_ai: 6, ai_breakfast: 5, the_signal: 4, tldr: 7, alphasignal: 3, product_hunt_ai: 5, huggingface: 5 },
    weekdayTotals: [40, 44, 39, 47, 45, 42, 50, 38], // median 43
    commitTime: new Date("2026-11-09T16:10:00Z"),
    issue: { id: "269", slug: "synthetic-monday", title: "Synthetic Monday", publishedAt: new Date("2026-11-09T17:05:00Z") },
    ...overrides,
  });
}

/** Tuesday with 30 stories (under half the median of 81) and nothing from AlphaSignal. */
export function thinDay(overrides: Partial<DayFacts> = {}): DayFacts {
  return normalDay({
    storiesBySource: { rundown_ai: 6, ai_breakfast: 5, the_signal: 4, tldr: 7, alphasignal: 0, product_hunt_ai: 4, huggingface: 4 },
    ...overrides,
  });
}

/** Tuesday at 10:05 with no ingest run and no stories. */
export function missingRun(overrides: Partial<DayFacts> = {}): DayFacts {
  return normalDay({
    ingestRun: null,
    storiesBySource: {},
    queuedStories: 0,
    committed: false,
    commitTime: null,
    draftsMade: 0,
    draftReady: false,
    issue: null,
    ...overrides,
  });
}

/** Tuesday the owner marked "No issue today", with the same empty facts as a missing run. */
export function skippedDate(overrides: Partial<DayFacts> = {}): DayFacts {
  return missingRun({
    skipped: { note: null, createdAt: new Date("2026-11-10T13:00:00Z") },
    ...overrides,
  });
}

/** Tuesday at 12:00 with stories but no commit yet. */
export function notCommitted(overrides: Partial<DayFacts> = {}): DayFacts {
  return normalDay({
    queuedStories: 0,
    committed: false,
    commitTime: null,
    draftsMade: 0,
    draftReady: false,
    issue: null,
    ...overrides,
  });
}

/** Committed at 11:42, but n8n's draft never got its email HTML. */
export function committedNoDraft(overrides: Partial<DayFacts> = {}): DayFacts {
  return normalDay({ draftsMade: 1, draftReady: false, issue: null, ...overrides });
}

/** A ready draft that is not published yet. */
export function draftNotPublished(overrides: Partial<DayFacts> = {}): DayFacts {
  return normalDay({
    issue: { id: "270", slug: "synthetic-model-ships", title: "Synthetic Model Ships & Agents Learn", publishedAt: null },
    ...overrides,
  });
}
