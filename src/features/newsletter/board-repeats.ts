import { storySources } from "@/src/features/newsletter/lead-story";
import type { SectionKey } from "@/src/features/newsletter/section-config";
import type { PaywallStatus } from "@/src/pipeline/ingest/paywall";
import { shiftDay } from "@/src/pipeline/repeats/match-stories";
import { createRepeatCheck, type RepeatCheck } from "@/src/pipeline/repeats/repeat-check";
import {
  applyRepeatRules,
  type ExcludedStory,
  type ReferenceKind,
  type RepeatReference,
  type SimilarStory,
  type StoryMatchRow,
} from "@/src/pipeline/repeats/repeat-rules";
import { readRepeatWindowDays } from "@/src/pipeline/repeats/repeats-store";
import { logServerError, logServerInfo } from "@/src/server/observability";
import { prisma } from "@/src/server/prisma";

/**
 * The repeat check on the board (#90, ADR 0006): removes repeats, merges duplicates into one story, and labels
 * similar stories, from the story matches ingestion stored. Candidates that ingestion did not check are checked here.
 */

/** A duplicate merged into the story the board shows. #59 uses it to prefer a free link. */
export interface AlsoFrom {
  id: number;
  source: string | null;
  headline: string | null;
  url: string | null;
  paywall_detected?: PaywallStatus;
}

export interface RepeatOf {
  id: number;
  headline: string;
  date: string;
  kind: ReferenceKind;
}

export interface BoardStory {
  id: number;
  source: string | null;
  sources?: string[];
  headline: string | null;
  url: string | null;
  paywall_detected?: PaywallStatus;
  also_from?: AlsoFrom[];
  similar_to?: SimilarStory[];
}

/** A story in an unsent draft: a reference for this board. */
export interface HeldStory {
  id: number;
  headline: string | null;
  held_for_date?: string | null;
}

/** A candidate the repeat check took off the board, and the story it repeats. */
export interface RemovedRepeat<S> {
  story: S;
  repeat_of: RepeatOf;
}

/** A removed repeat as the board lists it: with the section a restored copy goes to. */
export interface RestorableRepeat<S> extends RemovedRepeat<S> {
  section: SectionKey;
}

export interface BoardRepeats<T> {
  /**
   * The candidates that stay, in rank order. A head is the story the board shows for a group of duplicates: it
   * carries the group's `sources` and `also_from`, and its `similar_to` labels.
   */
  heads: T[];
  removed: RemovedRepeat<T>[];
  /** True when the check failed for some candidates: they may still hold repeats. */
  incomplete: boolean;
}

/** The day ("2026-11-06") of a date-only column. */
const dayOf = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

async function checkUnchecked(ids: number[], check: RepeatCheck): Promise<boolean> {
  try {
    const result = await check(ids);
    if (result.pairs > 0 || result.failed) logServerInfo("approval.repeats.checked", { ...result });
    return !result.failed;
  } catch (error) {
    logServerError("approval.repeats.check_failed", error, { candidateCount: ids.length });
    return false;
  }
}

async function loadMatches(ids: number[]): Promise<StoryMatchRow[]> {
  if (ids.length === 0) return [];
  return prisma.storyMatch.findMany({
    where: { OR: [{ newerStoryId: { in: ids } }, { olderStoryId: { in: ids } }] },
    select: { newerStoryId: true, olderStoryId: true, similarity: true, same: true, news: true },
  });
}

/** The stories in the matches that are not in `known`. */
function storiesReached(matches: StoryMatchRow[], known: Set<number>): number[] {
  const ids = new Set<number>();
  for (const match of matches) {
    for (const id of [match.newerStoryId, match.olderStoryId]) if (!known.has(id)) ids.add(id);
  }
  return [...ids];
}

export async function applyBoardRepeats<T extends BoardStory>(
  input: { date: string; candidates: T[]; held: HeldStory[] },
  deps: { check?: RepeatCheck } = {},
): Promise<BoardRepeats<T>> {
  const { date, candidates, held } = input;
  if (candidates.length === 0) return { heads: [], removed: [], incomplete: false };
  const check = deps.check ?? createRepeatCheck({ apiKey: process.env.OPENAI_API_KEY ?? "" });
  const candidateIds = new Set(candidates.map((story) => story.id));

  const complete = await checkUnchecked([...candidateIds], check);

  // Every pair that touches a candidate, and every pair of the stories those pairs reach (for chain labels).
  const candidateMatches = await loadMatches([...candidateIds]);
  const nextHopMatches = await loadMatches(storiesReached(candidateMatches, candidateIds));
  const seen = new Set<string>();
  const matches = [...candidateMatches, ...nextHopMatches].filter((match) => {
    const key = `${match.newerStoryId}-${match.olderStoryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const windowStart = shiftDay(date, -(await readRepeatWindowDays()));
  const otherStoryIds = storiesReached(matches, candidateIds);
  const rows = otherStoryIds.length
    ? await prisma.story.findMany({
        where: { id: { in: otherStoryIds } },
        select: { id: true, headline: true, usedInPublicationDate: true, excludeFromCandidates: true, excludedOn: true },
      })
    : [];

  const references = new Map<number, RepeatReference>();
  const excluded = new Map<number, ExcludedStory>();
  for (const row of rows) {
    const published = dayOf(row.usedInPublicationDate);
    if (published && published >= windowStart && published < date) {
      references.set(row.id, { headline: row.headline ?? "", date: published, kind: "published" });
    } else if (!published && row.excludeFromCandidates) {
      excluded.set(row.id, { headline: row.headline ?? "", excludedOn: dayOf(row.excludedOn) });
    }
  }
  for (const story of held) {
    if (story.held_for_date) references.set(story.id, { headline: story.headline ?? "", date: story.held_for_date, kind: "held" });
  }

  const result = applyRepeatRules({ candidates, matches, references, excluded });

  const heads = withGroups(result.heads, result.merged, result.similarTo);

  logServerInfo("approval.repeats.applied", {
    candidateCount: candidates.length,
    removedCount: result.removed.length,
    mergedCount: result.merged.length,
    labelledCount: result.similarTo.size,
    incomplete: !complete,
  });

  return {
    heads,
    removed: result.removed.map(({ story, repeatOf }) => ({ story, repeat_of: repeatOf })),
    incomplete: !complete,
  };
}

/** Gives each head its duplicates' sources, an `also_from` entry for each duplicate, and its labels. */
function withGroups<T extends BoardStory>(
  heads: T[],
  merged: { story: T; into: number }[],
  similarTo: Map<number, SimilarStory[]>,
): T[] {
  const duplicatesByHead = new Map<number, T[]>();
  for (const { story, into } of merged) duplicatesByHead.set(into, [...(duplicatesByHead.get(into) ?? []), story]);
  return heads.map((head) => {
    const duplicates = duplicatesByHead.get(head.id) ?? [];
    const similar = similarTo.get(head.id);
    if (duplicates.length === 0 && !similar) return head;
    return {
      ...head,
      ...(duplicates.length > 0
        ? {
            sources: storySources({ source: null, sources: [head, ...duplicates].flatMap((story) => storySources(story)) }),
            also_from: duplicates.map((duplicate) => ({
              id: duplicate.id,
              source: duplicate.source,
              headline: duplicate.headline,
              url: duplicate.url,
              paywall_detected: duplicate.paywall_detected,
            })),
          }
        : {}),
      ...(similar ? { similar_to: similar } : {}),
    };
  });
}
